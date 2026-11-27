import * as fs from 'fs';
import { mkdtempSync, rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { R2Service } from '../../infrastructure/r2/r2.service';
import { SongFilesService } from './song-files.service';

describe('SongFilesService local storage save', () => {
  const osActual = jest.requireActual('os') as typeof os;
  let home: string;
  let outside: string;

  beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), 'sonic-files-home-'));
    outside = mkdtempSync(path.join(os.tmpdir(), 'sonic-files-outside-'));
    jest.spyOn(osActual, 'homedir').mockReturnValue(home);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(home, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  function createLocalService() {
    const configService = {
      get: (key: string) => {
        if (key === 'STORAGE_MODE') return 'local';
        if (key === 'YTDLP_COOKIES_PATH')
          return path.join(
            os.tmpdir(),
            `sonic-missing-${Date.now()}-${Math.random()}.txt`,
          );
        return undefined;
      },
    } as unknown as ConfigService;
    const r2Service = {
      uploadFileBuffer: jest.fn(),
    } as unknown as R2Service;
    return {
      service: new SongFilesService(r2Service, configService),
      r2Service,
    };
  }

  function mockDownloadPipeline(
    service: SongFilesService,
    options: { writeFaststart: boolean } = { writeFaststart: true },
  ) {
    const execPromise = jest.fn(async (args: string[]) => {
      const outIndex = args.indexOf('-o');
      const tempBase = args[outIndex + 1] as string;
      fs.writeFileSync(`${tempBase}.m4a`, 'downloaded-bytes');
    });
    (service as any).ytDlpWrap = { execPromise };
    jest
      .spyOn(service as any, 'extractDurationInSeconds')
      .mockResolvedValue(120);
    jest
      .spyOn(service as any, 'applyFaststart')
      .mockImplementation(async (_input: string, output: string) => {
        if (options.writeFaststart) {
          fs.writeFileSync(output, 'faststart-bytes');
        }
      });
    return { execPromise };
  }

  it('saves the finished file to ~/songs without R2 calls', async () => {
    const { service, r2Service } = createLocalService();
    const { execPromise } = mockDownloadPipeline(service);

    const result = await service.downloadAudio('vid123');

    expect(result).toEqual({
      success: true,
      r2Key: 'songs/vid123.m4a',
      duration: 120,
    });
    expect(execPromise).toHaveBeenCalledTimes(1);
    expect(
      fs.readFileSync(path.join(home, 'songs', 'vid123.m4a'), 'utf8'),
    ).toBe('faststart-bytes');
    expect(r2Service.uploadFileBuffer).not.toHaveBeenCalled();
    expect(
      fs
        .readdirSync(path.join(home, 'songs'))
        .filter((name) => name.endsWith('.tmp')),
    ).toEqual([]);
  });

  it('cleans up the download temp files after a local save', async () => {
    const { service } = createLocalService();
    const { execPromise } = mockDownloadPipeline(service);

    await service.downloadAudio('vid123');

    const args = execPromise.mock.calls[0][0] as string[];
    const tempBase = args[args.indexOf('-o') + 1] as string;
    expect(fs.existsSync(`${tempBase}.m4a`)).toBe(false);
    expect(fs.existsSync(`${tempBase}-faststart.m4a`)).toBe(false);
  });

  it('rejects an invalid id before downloading', async () => {
    const { service, r2Service } = createLocalService();
    const { execPromise } = mockDownloadPipeline(service);

    await expect(service.downloadAudio('../vid123')).rejects.toThrow();
    expect(execPromise).not.toHaveBeenCalled();
    expect(r2Service.uploadFileBuffer).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(home, 'songs'))).toBe(false);
  });

  it('fails without writing outside when ~/songs is a symlink', async () => {
    fs.symlinkSync(outside, path.join(home, 'songs'));
    const { service, r2Service } = createLocalService();
    mockDownloadPipeline(service);

    await expect(service.downloadAudio('vid123')).rejects.toThrow(
      /Failed to process audio/,
    );
    expect(r2Service.uploadFileBuffer).not.toHaveBeenCalled();
    expect(fs.readdirSync(outside)).toEqual([]);
    expect(fs.existsSync(path.join(home, 'songs', 'vid123.m4a'))).toBe(false);
  });

  it('cleans up temp files after a local save failure', async () => {
    const { service, r2Service } = createLocalService();
    mockDownloadPipeline(service, { writeFaststart: false });

    await expect(service.downloadAudio('vid123')).rejects.toThrow(
      /Failed to process audio/,
    );
    expect(r2Service.uploadFileBuffer).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(home, 'songs', 'vid123.m4a'))).toBe(false);
    const leftovers = fs.existsSync(path.join(home, 'songs'))
      ? fs.readdirSync(path.join(home, 'songs'))
      : [];
    expect(leftovers.filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});
