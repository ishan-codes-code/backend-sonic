import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import {
  constants as fsConstants,
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { dirname, resolve } from 'path';
import { config as loadDotenv } from 'dotenv';
import { stripTrailingSlash } from './setup-requirements';

const DEFAULTS: Record<string, string | undefined> = {
  PORT: '3000',
  DATABASE_URL: undefined,
  STORAGE_MODE: undefined,
  JWT_ACCESS_SECRET: undefined,
  JWT_REFRESH_SECRET: undefined,
  JWT_ACCESS_EXPIRES_IN: '15m',
  JWT_REFRESH_EXPIRES_IN: '30d',
  JWT_PLAYBACK_SECRET: undefined,
  YOUTUBE_API_KEY: undefined,
  WORKER_URL: 'http://localhost:3001',
  WORKER_SECRET: undefined,
  WORKER_STREAM_SECRET: undefined,
  WORKER_STREAM_URL: undefined,
  API_CORS_ORIGIN: undefined,
  WORKER_PORT: '3001',
  WORKER_CORS_ORIGIN: undefined,
  R2_ACCOUNT_ID: undefined,
  R2_ACCESS_KEY: undefined,
  R2_SECRET_KEY: undefined,
  R2_BUCKET: undefined,
  YOUTUBE_API_KEY_DEV: undefined,
  YOUTUBE_API_KEY_BACKUP: undefined,
  YOUTUBE_API_KEY_PROD: undefined,
  CLOUDFLARE_ACCOUNT_ID: undefined,
  LASTFM_API_KEY: undefined,
  YTDLP_COOKIES_PATH: undefined,
  USE_WS_DB: undefined,
  NODE_ENV: undefined,
  TERMUX_PREFIX: undefined,
};

export const RUNTIME_CONFIG_KEYS = Object.keys(DEFAULTS).filter(
  (key) => key !== 'TERMUX_PREFIX',
);

export const SETUP_CONFIG_KEYS = [...RUNTIME_CONFIG_KEYS];

export interface RuntimeConfigOptions {
  generateSecrets?: boolean;
  readOnly?: boolean;
}

export type RuntimeConfig = Record<string, string | undefined>;

let loadedConfig: RuntimeConfig | undefined;
let dotenvLoaded = false;
const lockWait = new Int32Array(new SharedArrayBuffer(4));

export function getRuntimeConfigPath(): string {
  return resolve(
    process.cwd(),
    process.env.CONFIG_PATH || './data/config.json',
  );
}

function readConfigFile(configPath: string): Record<string, unknown> {
  if (!existsSync(configPath)) return {};

  const parsed: unknown = JSON.parse(readFileSync(configPath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      `Runtime config at ${configPath} must contain a JSON object`,
    );
  }
  return parsed as Record<string, unknown>;
}

function withConfigLock<T>(configPath: string, operation: () => T): T {
  const directory = dirname(configPath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lockPath = `${configPath}.lock`;
  const deadline = Date.now() + 15_000;
  let descriptor: number | undefined;

  while (descriptor === undefined) {
    try {
      descriptor = openSync(lockPath, 'wx', 0o600);
      writeFileSync(descriptor, `${process.pid}\n`);
      fsyncSync(descriptor);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;

      try {
        if (Date.now() - statSync(lockPath).mtimeMs > 60_000) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        // The lock may have been released while checking it.
      }

      if (Date.now() >= deadline) {
        throw new Error('Timed out waiting for the runtime config lock');
      }
      Atomics.wait(lockWait, 0, 0, 50);
    }
  }

  try {
    return operation();
  } finally {
    closeSync(descriptor);
    try {
      unlinkSync(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('Failed to release runtime config lock:', error);
      }
    }
  }
}

function atomicWrite(filePath: string, content: string): void {
  const directory = dirname(filePath);
  const tempPath = `${filePath}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(tempPath, 'wx', 0o600);
    writeFileSync(descriptor, content);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(tempPath, filePath);
    chmodSync(filePath, 0o600);
    const directoryDescriptor = openSync(directory, fsConstants.O_RDONLY);
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      unlinkSync(tempPath);
    } catch {
      // The rename may already have moved the temporary file.
    }
    throw error;
  }
}

function mergeConfig(fileConfig: Record<string, unknown>): RuntimeConfig {
  const merged: RuntimeConfig = {};
  for (const [key, defaultValue] of Object.entries(DEFAULTS)) {
    const fileValue = fileConfig[key];
    const environmentKey = key === 'TERMUX_PREFIX' ? 'PREFIX' : key;
    const value =
      process.env[environmentKey] ??
      (typeof fileValue === 'string' || typeof fileValue === 'number'
        ? String(fileValue)
        : defaultValue);
    merged[key] =
      key === 'WORKER_STREAM_URL' ? stripTrailingSlash(value) : value;
  }
  return merged;
}

function loadEnvFile(): void {
  if (!dotenvLoaded) {
    loadDotenv({ quiet: true });
    dotenvLoaded = true;
  }
}

export function loadRuntimeConfig(
  options: RuntimeConfigOptions = {},
): RuntimeConfig {
  if (loadedConfig) return loadedConfig;

  loadEnvFile();
  const configPath = getRuntimeConfigPath();
  let fileConfig = readConfigFile(configPath);

  if (options.generateSecrets && !options.readOnly) {
    const secrets = [
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'WORKER_SECRET',
    ] as const;
    const missing = secrets.filter(
      (key) => !process.env[key] && !fileConfig[key],
    );

    if (missing.length > 0) {
      withConfigLock(configPath, () => {
        fileConfig = readConfigFile(configPath);
        const generated: Record<string, string> = {};
        for (const key of missing) {
          if (!process.env[key] && !fileConfig[key]) {
            generated[key] = randomBytes(48).toString('hex');
          }
        }
        if (Object.keys(generated).length > 0) {
          atomicWrite(
            configPath,
            `${JSON.stringify({ ...fileConfig, ...generated }, null, 2)}\n`,
          );
          fileConfig = { ...fileConfig, ...generated };
        }
      });
    }
  }

  loadedConfig = mergeConfig(fileConfig);
  return loadedConfig;
}

export function reloadRuntimeConfig(
  options: RuntimeConfigOptions = {},
): RuntimeConfig {
  loadedConfig = undefined;
  return loadRuntimeConfig(options);
}

export function saveRuntimeConfig(
  patch: Record<string, string>,
): RuntimeConfig {
  const configPath = getRuntimeConfigPath();
  withConfigLock(configPath, () => {
    const current = readConfigFile(configPath);
    atomicWrite(
      configPath,
      `${JSON.stringify({ ...current, ...patch }, null, 2)}\n`,
    );
  });
  loadedConfig = mergeConfig(readConfigFile(configPath));
  return loadedConfig;
}

export function getEnvLockedKeys(): string[] {
  loadEnvFile();
  return RUNTIME_CONFIG_KEYS.filter((key) => process.env[key] !== undefined);
}

export function getRuntimeConfigEnvironment(
  overrides: Record<string, string>,
): NodeJS.ProcessEnv {
  loadEnvFile();
  return { ...process.env, ...overrides };
}

export function ensureSetupToken(): { token?: string; created: boolean } {
  const configPath = getRuntimeConfigPath();
  return withConfigLock(configPath, () => {
    const hashPath = resolve(dirname(configPath), 'setup-token.sha256');
    if (existsSync(hashPath)) return { created: false };

    const token = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    atomicWrite(hashPath, `${hash}\n`);
    return { token, created: true };
  });
}

export function verifySetupToken(token: string | undefined): boolean {
  if (!token) return false;
  const configPath = getRuntimeConfigPath();
  const hashPath = resolve(dirname(configPath), 'setup-token.sha256');
  if (!existsSync(hashPath)) return false;

  const expected = readFileSync(hashPath, 'utf8').trim();
  const actual = createHash('sha256').update(token).digest('hex');
  return (
    expected.length === actual.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
  );
}
