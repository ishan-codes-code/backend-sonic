import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { R2Service } from '../../infrastructure/r2/r2.service';
import { SongFilesService } from './song-files.service';

const ffmpegStatic = require('ffmpeg-static');

function createService(config: Record<string, string | undefined>) {
  const configService = {
    get: (key: string) => config[key],
  } as unknown as ConfigService;
  const r2Service = {} as R2Service;
  return new SongFilesService(r2Service, configService);
}

function buildArgs(
  service: SongFilesService,
  overrides?: { url?: string; tempFilePath?: string },
): string[] {
  const url = overrides?.url ?? 'https://www.youtube.com/watch?v=abc123';
  const tempFilePath =
    overrides?.tempFilePath ?? path.join(os.tmpdir(), 'abc123-out');
  return (service as any).buildYtDlpArgs(url, tempFilePath);
}

describe('SongFilesService yt-dlp args', () => {
  const missingCookiesPath = path.join(
    os.tmpdir(),
    `sonic-missing-cookies-${Date.now()}.txt`,
  );

  it('omits --ffmpeg-location on Termux so yt-dlp finds ffmpeg on PATH', () => {
    const service = createService({
      TERMUX_PREFIX: '/data/data/com.termux/files/usr',
      YTDLP_COOKIES_PATH: missingCookiesPath,
    });

    const args = buildArgs(service);

    expect(args).not.toContain('--ffmpeg-location');
    // No ffmpeg path value should leak in either (neither 'ffmpeg' nor static path).
    expect(args).not.toContain('ffmpeg');
    expect(args).not.toContain(ffmpegStatic as string);
  });

  it('passes ffmpeg-static via --ffmpeg-location elsewhere', () => {
    const service = createService({
      TERMUX_PREFIX: undefined,
      YTDLP_COOKIES_PATH: missingCookiesPath,
    });

    const args = buildArgs(service);
    const flagIndex = args.indexOf('--ffmpeg-location');

    expect(flagIndex).toBeGreaterThanOrEqual(0);
    expect(args[flagIndex + 1]).toBe(ffmpegStatic as string);
  });

  it.each([true, false])(
    'never forces a player client (isTermux=%s)',
    (isTermux) => {
      const service = createService({
        TERMUX_PREFIX: isTermux
          ? '/data/data/com.termux/files/usr'
          : undefined,
        YTDLP_COOKIES_PATH: missingCookiesPath,
      });

      const args = buildArgs(service);

      expect(args).not.toContain('--extractor-args');
      expect(args.join(' ')).not.toContain('player_client');
      expect(args.join(' ')).not.toContain('youtube:player_client=web');
    },
  );

  it.each([true, false])(
    'keeps other yt-dlp arguments unchanged (isTermux=%s)',
    (isTermux) => {
      const service = createService({
        TERMUX_PREFIX: isTermux
          ? '/data/data/com.termux/files/usr'
          : undefined,
        YTDLP_COOKIES_PATH: missingCookiesPath,
      });
      const url = 'https://www.youtube.com/watch?v=vid123';
      const tempFilePath = path.join(os.tmpdir(), 'vid123-out');

      const args = buildArgs(service, { url, tempFilePath });

      // Core format/extraction args from the known-good command.
      expect(args[0]).toBe(url);
      expect(args).toContain('-f');
      expect(args[args.indexOf('-f') + 1]).toBe('ba/b');
      expect(args).toContain('-x');
      expect(args).toContain('--audio-format');
      expect(args[args.indexOf('--audio-format') + 1]).toBe('aac');
      expect(args).toContain('--audio-quality');
      expect(args[args.indexOf('--audio-quality') + 1]).toBe('128K');
      expect(args).toContain('--js-runtimes');
      expect(args[args.indexOf('--js-runtimes') + 1]).toBe('node');
      expect(args).toContain('--remote-components');
      expect(args[args.indexOf('--remote-components') + 1]).toBe('ejs:github');
      expect(args).toContain('-4');
      expect(args).toContain('--no-check-certificate');
      expect(args).toContain('--cache-dir');
      // Output template.
      expect(args).toContain('-o');
      expect(args[args.indexOf('-o') + 1]).toBe(tempFilePath);
    },
  );

  it('still passes --cookies when the cookies file exists', () => {
    const cookiesPath = path.join(
      os.tmpdir(),
      `sonic-cookies-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
    );
    fs.writeFileSync(cookiesPath, '# cookies');
    try {
      const service = createService({
        TERMUX_PREFIX: undefined,
        YTDLP_COOKIES_PATH: cookiesPath,
      });

      const args = buildArgs(service);

      expect(args).toContain('--cookies');
      expect(args[args.indexOf('--cookies') + 1]).toBe(cookiesPath);
    } finally {
      fs.removeSync(cookiesPath);
    }
  });

  it('omits --cookies when the cookies file is missing', () => {
    const service = createService({
      TERMUX_PREFIX: undefined,
      YTDLP_COOKIES_PATH: path.join(
        os.tmpdir(),
        `sonic-no-cookies-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
      ),
    });

    const args = buildArgs(service);

    expect(args).not.toContain('--cookies');
  });

  it('keeps direct ffmpeg calls working on both platforms', () => {
    const termux = createService({
      TERMUX_PREFIX: '/data/data/com.termux/files/usr',
    });
    const standard = createService({ TERMUX_PREFIX: undefined });

    expect((termux as any).getFfmpegPath()).toBe('ffmpeg');
    expect((standard as any).getFfmpegPath()).toBe(ffmpegStatic as string);
  });
});

describe('SongFilesService downloadAudio forwards the fixed args', () => {
  // NOTE: `import * as fs` is a frozen ESM namespace, so patch the mutable
  // CommonJS exports object that the service actually uses at runtime.
  const fsExtra = jest.requireActual('fs-extra') as typeof fs;
  let existsSyncSpy: jest.SpyInstance;
  let readFileSyncSpy: jest.SpyInstance;
  let removeSpy: jest.SpyInstance;

  beforeEach(() => {
    existsSyncSpy = jest.spyOn(fsExtra, 'existsSync');
    readFileSyncSpy = jest.spyOn(fsExtra, 'readFileSync');
    removeSpy = jest
      .spyOn(fsExtra, 'remove')
      .mockImplementation(() => Promise.resolve() as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function runDownload(isTermux: boolean) {
    const missingCookies = path.join(
      os.tmpdir(),
      `sonic-missing-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
    );
    const configService = {
      get: (key: string) =>
        key === 'TERMUX_PREFIX'
          ? isTermux
            ? '/data/data/com.termux/files/usr'
            : undefined
          : key === 'YTDLP_COOKIES_PATH'
            ? missingCookies
            : undefined,
    } as unknown as ConfigService;
    const r2Service = {
      uploadFileBuffer: jest.fn().mockResolvedValue('r2-key'),
    } as unknown as R2Service;
    const service = new SongFilesService(r2Service, configService);

    const execPromise = jest.fn().mockResolvedValue(undefined);
    (service as any).ytDlpWrap = { execPromise };
    // Output file appears after yt-dlp runs; cookies file does not exist.
    existsSyncSpy.mockImplementation((p: any) => String(p).endsWith('.m4a'));
    jest
      .spyOn(service as any, 'extractDurationInSeconds')
      .mockResolvedValue(120);
    jest.spyOn(service as any, 'applyFaststart').mockResolvedValue(undefined);
    readFileSyncSpy.mockReturnValue(Buffer.from('audio') as any);

    await service.downloadAudio('vid123');

    expect(execPromise).toHaveBeenCalledTimes(1);
    return execPromise.mock.calls[0][0] as string[];
  }

  it('downloadAudio on Termux: no --ffmpeg-location, no player client', async () => {
    const args = await runDownload(true);

    expect(args).not.toContain('--ffmpeg-location');
    expect(args).not.toContain('--extractor-args');
    expect(args.join(' ')).not.toContain('player_client');
    expect(args).toContain('--js-runtimes');
    expect(args).toContain('--remote-components');
  });

  it('downloadAudio elsewhere: ffmpeg-static location, no player client', async () => {
    const args = await runDownload(false);

    const flagIndex = args.indexOf('--ffmpeg-location');
    expect(flagIndex).toBeGreaterThanOrEqual(0);
    expect(args[flagIndex + 1]).toBe(ffmpegStatic as string);
    expect(args).not.toContain('--extractor-args');
    expect(args.join(' ')).not.toContain('player_client');
  });
});
