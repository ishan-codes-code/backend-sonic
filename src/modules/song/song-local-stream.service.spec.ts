import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  closeSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SongLocalStreamService } from './song-local-stream.service';

const PLAYBACK_SECRET = 'local-stream-playback-secret';
const OTHER_SECRET = 'some-other-secret';

function createService(secret: string | undefined) {
  const configService = {
    get: (key: string) => (key === 'JWT_PLAYBACK_SECRET' ? secret : undefined),
  } as unknown as ConfigService;
  return new SongLocalStreamService(configService);
}

async function signPlaybackToken(
  payload: Record<string, unknown> = {},
  secret: string = PLAYBACK_SECRET,
): Promise<string> {
  const jwt = new JwtService({ secret });
  return jwt.signAsync(
    { sub: 'user-1', deviceId: 'device-1', scope: 'stream', ...payload },
    payload.exp === undefined ? { expiresIn: '1h' } : undefined,
  );
}

describe('SongLocalStreamService tokens', () => {
  it('accepts a valid playback token', async () => {
    const service = createService(PLAYBACK_SECRET);
    const token = await signPlaybackToken();

    const payload = await service.verifyPlaybackToken(`Bearer ${token}`);

    expect(payload.sub).toBe('user-1');
    expect(payload.deviceId).toBe('device-1');
    expect(payload.scope).toBe('stream');
  });

  it('rejects an expired playback token', async () => {
    const service = createService(PLAYBACK_SECRET);
    const token = await signPlaybackToken({
      exp: Math.floor(Date.now() / 1000) - 60,
    });

    await expect(
      service.verifyPlaybackToken(`Bearer ${token}`),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a token signed with another secret (login token shape)', async () => {
    const service = createService(PLAYBACK_SECRET);
    const jwt = new JwtService({ secret: OTHER_SECRET });
    const loginLike = await jwt.signAsync(
      { sub: 'user-1', email: 'user@example.com' },
      { expiresIn: '15m' },
    );

    await expect(
      service.verifyPlaybackToken(`Bearer ${loginLike}`),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a correctly signed token without scope stream', async () => {
    const service = createService(PLAYBACK_SECRET);
    const jwt = new JwtService({ secret: PLAYBACK_SECRET });
    const noScope = await jwt.signAsync(
      { sub: 'user-1', email: 'user@example.com' },
      { expiresIn: '15m' },
    );

    await expect(
      service.verifyPlaybackToken(`Bearer ${noScope}`),
    ).rejects.toMatchObject({ status: 401 });
  });

  it.each([[undefined], [''], ['Token abc'], ['Bearer '], ['Bearer a b']])(
    'rejects a malformed authorization header (%s)',
    async (header) => {
      const service = createService(PLAYBACK_SECRET);

      await expect(service.verifyPlaybackToken(header)).rejects.toMatchObject({
        status: 401,
      });
    },
  );

  it('fails closed when no playback secret is configured', async () => {
    const service = createService(undefined);
    const token = await signPlaybackToken();

    await expect(
      service.verifyPlaybackToken(`Bearer ${token}`),
    ).rejects.toMatchObject({ status: 500 });
  });
});

describe('SongLocalStreamService files', () => {
  const osActual = jest.requireActual('os') as typeof import('os');
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'sonic-stream-home-'));
    jest.spyOn(osActual, 'homedir').mockReturnValue(home);
    mkdirSync(join(home, 'songs'), { recursive: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(home, { recursive: true, force: true });
  });

  it('resolves valid ids inside ~/songs and rejects the rest', () => {
    const service = createService(PLAYBACK_SECRET);

    expect(service.resolveFilePath('abc123')).toBe(
      join(home, 'songs', 'abc123.m4a'),
    );
    expect(() => service.resolveFilePath('../abc123')).toThrow(
      expect.objectContaining({ status: 400 }),
    );
    expect(() => service.resolveFilePath('a/b')).toThrow(
      expect.objectContaining({ status: 400 }),
    );
    expect(() => service.resolveFilePath('')).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });

  it('opens regular files and reports their size', () => {
    const service = createService(PLAYBACK_SECRET);
    writeFileSync(join(home, 'songs', 'abc123.m4a'), '12345678');

    const { fd, size } = service.openLocalFile(
      join(home, 'songs', 'abc123.m4a'),
    );
    expect(size).toBe(8);
    closeSync(fd);
  });

  it('returns 404 for a missing file', () => {
    const service = createService(PLAYBACK_SECRET);

    expect(() =>
      service.openLocalFile(join(home, 'songs', 'missing1.m4a')),
    ).toThrow(expect.objectContaining({ status: 404 }));
  });

  it('returns 404 for symlinks and directories', () => {
    const service = createService(PLAYBACK_SECRET);
    writeFileSync(join(home, 'songs', 'real1234.m4a'), 'audio');
    symlinkSync(
      join(home, 'songs', 'real1234.m4a'),
      join(home, 'songs', 'link1234.m4a'),
    );
    symlinkSync(join(home, 'songs'), join(home, 'songs', 'dirlink.m4a'), 'dir');
    mkdirSync(join(home, 'songs', 'subdir.m4a'));

    expect(() =>
      service.openLocalFile(join(home, 'songs', 'link1234.m4a')),
    ).toThrow(expect.objectContaining({ status: 404 }));
    expect(() =>
      service.openLocalFile(join(home, 'songs', 'dirlink.m4a')),
    ).toThrow(expect.objectContaining({ status: 404 }));
    expect(() =>
      service.openLocalFile(join(home, 'songs', 'subdir.m4a')),
    ).toThrow(expect.objectContaining({ status: 404 }));
  });

  it('never opens files outside ~/songs', () => {
    const service = createService(PLAYBACK_SECRET);
    writeFileSync(join(home, 'outside.m4a'), 'nope');

    expect(() => service.resolveFilePath('../outside')).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });
});

describe('SongLocalStreamService ranges', () => {
  const service = createService(PLAYBACK_SECRET);

  it('serves the full file when no range is given', () => {
    expect(service.parseRange(undefined, 100)).toEqual({ type: 'full' });
  });

  it.each([
    ['bytes=0-99', 1000, { type: 'range', start: 0, end: 99 }],
    ['bytes=100-', 1000, { type: 'range', start: 100, end: 999 }],
    ['bytes=0-', 100, { type: 'range', start: 0, end: 99 }],
    ['bytes=-50', 1000, { type: 'range', start: 950, end: 999 }],
    ['bytes=-5000', 100, { type: 'range', start: 0, end: 99 }],
    ['bytes=0-9999', 100, { type: 'range', start: 0, end: 99 }],
    ['bytes=99-99', 100, { type: 'range', start: 99, end: 99 }],
  ])('parses %s against size %d', (header, size, expected) => {
    expect(service.parseRange(header, size)).toEqual(expected);
  });

  it.each([
    ['bytes=1000-', 1000],
    ['bytes=5000-6000', 1000],
    ['bytes=5-3', 100],
    ['bytes=0-', 0],
  ])('reports %s against size %d as unsatisfiable', (header, size) => {
    expect(service.parseRange(header, size)).toEqual({
      type: 'unsatisfiable',
    });
  });

  it.each([
    ['bytes=0-1,3-4', 100],
    ['items=0-1', 100],
    ['garbage', 100],
    ['bytes=', 100],
    ['bytes=-', 100],
    ['bytes=-0', 100],
    ['bytes=a-b', 100],
    ['bytes=10', 100],
  ])('ignores %s and serves the full file', (header, size) => {
    expect(service.parseRange(header, size)).toEqual({ type: 'full' });
  });

  it('uses the first header when several ranges are sent', () => {
    expect(service.parseRange(['bytes=0-9', 'bytes=20-29'], 100)).toEqual({
      type: 'range',
      start: 0,
      end: 9,
    });
  });
});
