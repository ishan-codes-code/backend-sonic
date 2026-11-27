import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Response } from 'express';
import { SetupController } from '../../apps/api/setup.controller';
import {
  ensureSetupToken,
  reloadRuntimeConfig,
  saveRuntimeConfig,
} from '../../infrastructure/config/runtime-config';

const ENV_KEYS = [
  'CONFIG_PATH',
  'STORAGE_MODE',
  'DATABASE_URL',
  'R2_ACCOUNT_ID',
  'CLOUDFLARE_ACCOUNT_ID',
  'R2_ACCESS_KEY',
  'R2_SECRET_KEY',
  'R2_BUCKET',
  'WORKER_STREAM_URL',
  'JWT_PLAYBACK_SECRET',
  'YOUTUBE_API_KEY',
  'LASTFM_API_KEY',
  'WORKER_SECRET',
  'PORT',
];

function mockResponse() {
  return {
    once: jest.fn(),
  } as unknown as Response;
}

describe('SetupController local storage mode', () => {
  // os.homedir() reads the real process environment, which the jest sandbox
  // cannot change via process.env, so tests point it at a temp home instead.
  const osActual = jest.requireActual('os') as typeof import('os');
  let directory: string;
  let home: string;
  let previousEnv: Record<string, string | undefined>;
  let controller: SetupController;
  let token: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'sonic-setup-config-'));
    home = mkdtempSync(join(tmpdir(), 'sonic-setup-home-'));
    previousEnv = {};
    for (const key of ENV_KEYS) {
      previousEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.CONFIG_PATH = join(directory, 'config.json');
    jest.spyOn(osActual, 'homedir').mockReturnValue(home);
    reloadRuntimeConfig({ readOnly: true });

    controller = new SetupController();
    token = ensureSetupToken().token as string;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
    reloadRuntimeConfig({ readOnly: true });
    jest.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  function readSavedConfig(): Record<string, string> {
    return JSON.parse(
      readFileSync(join(directory, 'config.json'), 'utf8'),
    ) as Record<string, string>;
  }

  it('advertises local support through the setup status', () => {
    const status = controller.getStatus(token);

    expect(status.storageModes).toEqual(['local', 'r2']);
  });

  it('rejects setup calls without a valid token', async () => {
    expect(() => controller.getStatus('nope')).toThrow(
      expect.objectContaining({ status: 401 }),
    );
    await expect(
      controller.saveConfig('nope', { STORAGE_MODE: 'local' }, mockResponse()),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('saves a local setup and generates the playback secret', async () => {
    const res = mockResponse();
    const response = await controller.saveConfig(
      token,
      {
        STORAGE_MODE: 'local',
        YOUTUBE_API_KEY: 'youtube-key',
        LASTFM_API_KEY: 'lastfm-key',
      },
      res,
    );

    expect(response.saved).toBe(true);
    expect(response.storageMode).toBe('local');
    expect(response.generatedKeys).toEqual(['JWT_PLAYBACK_SECRET']);
    // DATABASE_URL still comes from the installer, so setup stays required.
    expect(response.setupRequired).toBe(true);
    const saved = readSavedConfig();
    expect(saved.STORAGE_MODE).toBe('local');
    expect(saved.JWT_PLAYBACK_SECRET).toMatch(/^[0-9a-f]{96}$/);
    expect(res.once).toHaveBeenCalledWith('finish', expect.any(Function));
  });

  it('completes local setup without R2 keys, stream URL, or playback secret', async () => {
    saveRuntimeConfig({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    });

    const response = await controller.saveConfig(
      token,
      {
        STORAGE_MODE: 'local',
        YOUTUBE_API_KEY: 'youtube-key',
        LASTFM_API_KEY: 'lastfm-key',
      },
      mockResponse(),
    );

    expect(response.setupRequired).toBe(false);
    expect(response.storageMode).toBe('local');
    const status = controller.getStatus(token);
    expect(status.setupRequired).toBe(false);
    expect(status.configured.R2_BUCKET).toBe(false);
    expect(status.configured.WORKER_STREAM_URL).toBe(false);
  });

  it('never replaces an existing playback secret in local mode', async () => {
    saveRuntimeConfig({ JWT_PLAYBACK_SECRET: 'keep-this-secret' });

    const response = await controller.saveConfig(
      token,
      { STORAGE_MODE: 'local' },
      mockResponse(),
    );

    expect(response.generatedKeys).toEqual([]);
    expect(readSavedConfig().JWT_PLAYBACK_SECRET).toBe('keep-this-secret');
  });

  it('keeps a user-provided playback secret in local mode', async () => {
    const response = await controller.saveConfig(
      token,
      { STORAGE_MODE: 'local', JWT_PLAYBACK_SECRET: 'user-secret' },
      mockResponse(),
    );

    expect(response.generatedKeys).toEqual([]);
    expect(readSavedConfig().JWT_PLAYBACK_SECRET).toBe('user-secret');
  });

  it('rejects other STORAGE_MODE values without saving', async () => {
    await expect(
      controller.saveConfig(
        token,
        { STORAGE_MODE: 's3', YOUTUBE_API_KEY: 'youtube-key' },
        mockResponse(),
      ),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      controller.saveConfig(token, { STORAGE_MODE: '' }, mockResponse()),
    ).rejects.toMatchObject({ status: 400 });

    expect(() =>
      readFileSync(join(directory, 'config.json'), 'utf8'),
    ).toThrow();
  });

  it('rejects a blank user-provided playback secret in local mode', async () => {
    await expect(
      controller.saveConfig(
        token,
        { STORAGE_MODE: 'local', JWT_PLAYBACK_SECRET: '   ' },
        mockResponse(),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('fails a local save clearly when ~/songs cannot be used', async () => {
    writeFileSync(join(home, 'songs'), 'blocking file');

    await expect(
      controller.saveConfig(token, { STORAGE_MODE: 'local' }, mockResponse()),
    ).rejects.toMatchObject({ status: 400 });

    expect(() =>
      readFileSync(join(directory, 'config.json'), 'utf8'),
    ).toThrow();
  });

  it('fails a local save clearly when ~/songs is a symlink', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'sonic-setup-outside-'));
    try {
      symlinkSync(outside, join(home, 'songs'));

      await expect(
        controller.saveConfig(
          token,
          {
            STORAGE_MODE: 'local',
            YOUTUBE_API_KEY: 'youtube-key',
            LASTFM_API_KEY: 'lastfm-key',
          },
          mockResponse(),
        ),
      ).rejects.toMatchObject({ status: 400 });

      expect(() =>
        readFileSync(join(directory, 'config.json'), 'utf8'),
      ).toThrow();
      expect(readdirSync(outside)).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('keeps r2 defaults: no secret generation and unchanged requirements', async () => {
    const response = await controller.saveConfig(
      token,
      { YOUTUBE_API_KEY: 'youtube-key' },
      mockResponse(),
    );

    expect(response.storageMode).toBe('r2');
    expect(response.generatedKeys).toEqual([]);
    expect(response.setupRequired).toBe(true);
    const saved = readSavedConfig();
    expect(saved.JWT_PLAYBACK_SECRET).toBeUndefined();
  });

  it('honors an environment-provided storage mode and secret', async () => {
    process.env.STORAGE_MODE = 'local';
    process.env.JWT_PLAYBACK_SECRET = 'env-playback-secret';
    saveRuntimeConfig({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    });

    const response = await controller.saveConfig(
      token,
      { YOUTUBE_API_KEY: 'youtube-key', LASTFM_API_KEY: 'lastfm-key' },
      mockResponse(),
    );

    expect(response.storageMode).toBe('local');
    expect(response.setupRequired).toBe(false);
    expect(response.generatedKeys).toEqual([]);

    await expect(
      controller.saveConfig(token, { STORAGE_MODE: 'r2' }, mockResponse()),
    ).rejects.toThrow(/environment-locked/);
  });
});
