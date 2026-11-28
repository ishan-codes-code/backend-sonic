import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { SongLocalStreamService } from './song-local-stream.service';
import { SongStreamController } from './song-stream.controller';

const PLAYBACK_SECRET = 'controller-playback-secret';
const FILE_BYTES = Buffer.from('0123456789abcdef'.repeat(64)); // 1024 bytes

async function signPlaybackToken(
  secret: string = PLAYBACK_SECRET,
  payload: Record<string, unknown> = {},
  expiresIn: string | null = '1h',
): Promise<string> {
  const jwt = new JwtService({ secret });
  return jwt.signAsync(
    { sub: 'user-1', deviceId: 'device-1', scope: 'stream', ...payload },
    expiresIn ? { expiresIn: expiresIn as never } : undefined,
  );
}

function bufferBody(req: request.Test): request.Test {
  return req
    .buffer(true)
    .parse(
      (
        res: NodeJS.ReadableStream,
        done: (err: Error | null, body?: unknown) => void,
      ) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
        res.on('error', (err: Error) => done(err));
      },
    );
}

describe('SongStreamController (local mode)', () => {
  const osActual = jest.requireActual('os') as typeof import('os');
  let app: INestApplication;
  let moduleRef: TestingModule;
  let home: string;
  let token: string;
  let loggedArgs: string[];

  const configMock = {
    get: (key: string) => {
      if (key === 'storage.mode') return 'local';
      if (key === 'JWT_PLAYBACK_SECRET') return PLAYBACK_SECRET;
      return undefined;
    },
  } as unknown as ConfigService;

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'sonic-controller-home-'));
    jest.spyOn(osActual, 'homedir').mockReturnValue(home);
    mkdirSync(join(home, 'songs'), { recursive: true });
    writeFileSync(join(home, 'songs', 'abc123.m4a'), FILE_BYTES);

    token = await signPlaybackToken();

    loggedArgs = [];
    for (const method of ['debug', 'log', 'warn', 'error'] as const) {
      jest
        .spyOn(Logger.prototype, method)
        .mockImplementation((...args: unknown[]) => {
          loggedArgs.push(args.map(String).join(' '));
        });
    }

    moduleRef = await Test.createTestingModule({
      controllers: [SongStreamController],
      providers: [
        SongLocalStreamService,
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await moduleRef.close();
    jest.restoreAllMocks();
    rmSync(home, { recursive: true, force: true });

    const leaked = loggedArgs.filter((line) => line.includes(token));
    expect(leaked).toEqual([]);
  });

  it('streams the full file with 200 and audio headers', async () => {
    const res = await bufferBody(
      request(app.getHttpServer())
        .get('/stream/abc123')
        .set('Authorization', `Bearer ${token}`),
    ).expect(200);

    expect(res.headers['content-type']).toContain('audio/mp4');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-length']).toBe(String(FILE_BYTES.length));
    expect(res.headers['content-range']).toBeUndefined();
    expect(Buffer.compare(res.body as Buffer, FILE_BYTES)).toBe(0);
  });

  it('streams a single range with 206', async () => {
    const res = await bufferBody(
      request(app.getHttpServer())
        .get('/stream/abc123')
        .set('Authorization', `Bearer ${token}`)
        .set('Range', 'bytes=0-99'),
    ).expect(206);

    expect(res.headers['content-range']).toBe(
      `bytes 0-99/${FILE_BYTES.length}`,
    );
    expect(res.headers['content-length']).toBe('100');
    expect(
      Buffer.compare(res.body as Buffer, FILE_BYTES.subarray(0, 100)),
    ).toBe(0);
  });

  it('streams a suffix range with 206', async () => {
    const res = await bufferBody(
      request(app.getHttpServer())
        .get('/stream/abc123')
        .set('Authorization', `Bearer ${token}`)
        .set('Range', 'bytes=-16'),
    ).expect(206);

    expect(res.headers['content-range']).toBe(
      `bytes ${FILE_BYTES.length - 16}-${FILE_BYTES.length - 1}/${FILE_BYTES.length}`,
    );
    expect(Buffer.compare(res.body as Buffer, FILE_BYTES.subarray(-16))).toBe(
      0,
    );
  });

  it('answers 416 with bytes star for an unsatisfiable range', async () => {
    const res = await request(app.getHttpServer())
      .get('/stream/abc123')
      .set('Authorization', `Bearer ${token}`)
      .set('Range', `bytes=${FILE_BYTES.length}-`)
      .expect(416);

    expect(res.headers['content-range']).toBe(`bytes */${FILE_BYTES.length}`);
  });

  it('answers HEAD with headers and no body', async () => {
    const res = await request(app.getHttpServer())
      .head('/stream/abc123')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.headers['content-length']).toBe(String(FILE_BYTES.length));
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.text).toBeUndefined();
  });

  it('answers HEAD with range headers and no body', async () => {
    const res = await request(app.getHttpServer())
      .head('/stream/abc123')
      .set('Authorization', `Bearer ${token}`)
      .set('Range', 'bytes=0-9')
      .expect(206);

    expect(res.headers['content-range']).toBe(`bytes 0-9/${FILE_BYTES.length}`);
    expect(res.headers['content-length']).toBe('10');
    expect(res.text).toBeUndefined();
  });

  it('returns 404 for a missing file', async () => {
    await request(app.getHttpServer())
      .get('/stream/missing9')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('returns 400 for an invalid id', async () => {
    await request(app.getHttpServer())
      .get('/stream/abc.m4a')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('returns 401 without a token', async () => {
    await request(app.getHttpServer()).get('/stream/abc123').expect(401);
  });

  it('returns 401 for a login token', async () => {
    const loginLike = await signPlaybackToken(PLAYBACK_SECRET, {
      scope: undefined,
      email: 'user@example.com',
    } as unknown as Record<string, unknown>);

    await request(app.getHttpServer())
      .get('/stream/abc123')
      .set('Authorization', `Bearer ${loginLike}`)
      .expect(401);
  });

  it('returns 401 for an expired token', async () => {
    const expired = await signPlaybackToken(
      PLAYBACK_SECRET,
      { exp: Math.floor(Date.now() / 1000) - 60 },
      null,
    );

    await request(app.getHttpServer())
      .get('/stream/abc123')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401);
  });
});

describe('SongStreamController (unsafe music directory)', () => {
  const osActual = jest.requireActual('os') as typeof import('os');
  let app: INestApplication;
  let moduleRef: TestingModule;
  let home: string;
  let outside: string;

  const configMock = {
    get: (key: string) => {
      if (key === 'storage.mode') return 'local';
      if (key === 'JWT_PLAYBACK_SECRET') return PLAYBACK_SECRET;
      return undefined;
    },
  } as unknown as ConfigService;

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'sonic-unsafe-home-'));
    outside = mkdtempSync(join(tmpdir(), 'sonic-unsafe-outside-'));
    jest.spyOn(osActual, 'homedir').mockReturnValue(home);
    writeFileSync(join(outside, 'abc123.m4a'), 'outside-bytes');
    symlinkSync(outside, join(home, 'songs'));

    moduleRef = await Test.createTestingModule({
      controllers: [SongStreamController],
      providers: [
        SongLocalStreamService,
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await moduleRef.close();
    jest.restoreAllMocks();
    rmSync(home, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('returns 404 instead of serving through a symlinked ~/songs', async () => {
    const token = await signPlaybackToken();

    const res = await request(app.getHttpServer())
      .get('/stream/abc123')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expect(JSON.stringify(res.body)).not.toContain('outside-bytes');
  });
});

describe('SongStreamController (r2 mode)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    const configMock = {
      get: (key: string) => {
        if (key === 'storage.mode') return 'r2';
        if (key === 'JWT_PLAYBACK_SECRET') return PLAYBACK_SECRET;
        return undefined;
      },
    } as unknown as ConfigService;

    moduleRef = await Test.createTestingModule({
      controllers: [SongStreamController],
      providers: [
        SongLocalStreamService,
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await moduleRef.close();
  });

  it('answers 404 without serving local files', async () => {
    const token = await signPlaybackToken();

    await request(app.getHttpServer())
      .get('/stream/abc123')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
