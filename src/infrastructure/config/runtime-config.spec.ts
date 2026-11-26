import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  ensureSetupToken,
  reloadRuntimeConfig,
  saveRuntimeConfig,
  verifySetupToken,
} from './runtime-config';

describe('runtime config persistence', () => {
  let directory: string;
  let previousConfigPath: string | undefined;
  let previousPort: string | undefined;
  let previousWorkerSecret: string | undefined;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'sonic-config-'));
    previousConfigPath = process.env.CONFIG_PATH;
    previousPort = process.env.PORT;
    previousWorkerSecret = process.env.WORKER_SECRET;
    process.env.CONFIG_PATH = join(directory, 'config.json');
    process.env.PORT = '3100';
    process.env.WORKER_SECRET = 'worker-secret';
    reloadRuntimeConfig({ readOnly: true });
  });

  afterEach(() => {
    if (previousConfigPath === undefined) delete process.env.CONFIG_PATH;
    else process.env.CONFIG_PATH = previousConfigPath;
    if (previousPort === undefined) delete process.env.PORT;
    else process.env.PORT = previousPort;
    if (previousWorkerSecret === undefined) delete process.env.WORKER_SECRET;
    else process.env.WORKER_SECRET = previousWorkerSecret;
    reloadRuntimeConfig({ readOnly: true });
    rmSync(directory, { recursive: true, force: true });
  });

  it('atomically writes mode 0600 and merges file values under env overrides', () => {
    saveRuntimeConfig({ PORT: '3200', WORKER_SECRET: 'worker-secret' });

    expect(statSync(process.env.CONFIG_PATH!).mode & 0o777).toBe(0o600);
    expect(reloadRuntimeConfig().PORT).toBe('3100');
    expect(reloadRuntimeConfig().WORKER_SECRET).toBe('worker-secret');
    expect(JSON.parse(readFileSync(process.env.CONFIG_PATH!, 'utf8'))).toEqual({
      PORT: '3200',
      WORKER_SECRET: 'worker-secret',
    });
  });

  it('stores and checks only a hash of the setup token', () => {
    const setupToken = ensureSetupToken();

    expect(setupToken.created).toBe(true);
    expect(setupToken.token).toBeDefined();
    expect(verifySetupToken(setupToken.token)).toBe(true);
    expect(verifySetupToken('invalid-token')).toBe(false);
    expect(
      readFileSync(join(directory, 'setup-token.sha256'), 'utf8'),
    ).not.toContain(setupToken.token!);
    expect(ensureSetupToken()).toEqual({ created: false });
  });

  it('does not create config files while loading in read-only mode', () => {
    reloadRuntimeConfig({ readOnly: true });

    expect(existsSync(process.env.CONFIG_PATH!)).toBe(false);
  });

  describe('setup keys', () => {
    let previousStreamUrl: string | undefined;
    let previousPlaybackSecret: string | undefined;

    beforeEach(() => {
      previousStreamUrl = process.env.WORKER_STREAM_URL;
      previousPlaybackSecret = process.env.JWT_PLAYBACK_SECRET;
      delete process.env.WORKER_STREAM_URL;
      delete process.env.JWT_PLAYBACK_SECRET;
      reloadRuntimeConfig({ readOnly: true });
    });

    afterEach(() => {
      if (previousStreamUrl === undefined) {
        delete process.env.WORKER_STREAM_URL;
      } else {
        process.env.WORKER_STREAM_URL = previousStreamUrl;
      }
      if (previousPlaybackSecret === undefined) {
        delete process.env.JWT_PLAYBACK_SECRET;
      } else {
        process.env.JWT_PLAYBACK_SECRET = previousPlaybackSecret;
      }
      reloadRuntimeConfig({ readOnly: true });
    });

    it('accepts and saves the user-provided playback secret', () => {
      saveRuntimeConfig({ JWT_PLAYBACK_SECRET: 'user-playback-secret' });

      expect(reloadRuntimeConfig().JWT_PLAYBACK_SECRET).toBe(
        'user-playback-secret',
      );
    });

    it('never generates the playback secret', () => {
      expect(
        reloadRuntimeConfig({ generateSecrets: true }).JWT_PLAYBACK_SECRET,
      ).toBeUndefined();
    });

    it('has no default stream URL', () => {
      expect(reloadRuntimeConfig().WORKER_STREAM_URL).toBeUndefined();
    });

    it('strips trailing slashes from the stream URL', () => {
      saveRuntimeConfig({
        WORKER_STREAM_URL: 'https://worker.example.com/',
      });

      expect(reloadRuntimeConfig().WORKER_STREAM_URL).toBe(
        'https://worker.example.com',
      );

      process.env.WORKER_STREAM_URL = 'https://env-worker.example.com///';
      expect(reloadRuntimeConfig().WORKER_STREAM_URL).toBe(
        'https://env-worker.example.com',
      );
    });
  });
});
