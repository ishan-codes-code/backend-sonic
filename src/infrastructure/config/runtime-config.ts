import { randomBytes } from 'crypto';
import {
  constants as fsConstants,
  accessSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { dirname, resolve } from 'path';
import { config as loadDotenv } from 'dotenv';

const DEFAULTS: Record<string, string | undefined> = {
  PORT: '3000',
  DATABASE_URL: undefined,
  JWT_ACCESS_SECRET: undefined,
  JWT_REFRESH_SECRET: undefined,
  JWT_ACCESS_EXPIRES_IN: '15m',
  JWT_REFRESH_EXPIRES_IN: '30d',
  YOUTUBE_API_KEY: undefined,
  WORKER_URL: 'http://localhost:3001',
  WORKER_SECRET: undefined,
  WORKER_STREAM_SECRET: undefined,
  WORKER_STREAM_URL: 'http://127.0.0.1:8787',
  API_CORS_ORIGIN: undefined,
  WORKER_PORT: '3001',
  WORKER_CORS_ORIGIN: undefined,
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: '6379',
  R2_ACCOUNT_ID: undefined,
  R2_ACCESS_KEY: undefined,
  R2_SECRET_KEY: undefined,
  R2_BUCKET: undefined,
  YOUTUBE_API_KEY_DEV: undefined,
  YOUTUBE_API_KEY_BACKUP: undefined,
  YOUTUBE_API_KEY_PROD: undefined,
  REDIS_URL: undefined,
  CLOUDFLARE_ACCOUNT_ID: undefined,
  LASTFM_API_KEY: undefined,
  YTDLP_COOKIES_PATH: undefined,
  USE_WS_DB: undefined,
  NODE_ENV: undefined,
};

let loadedConfig: Record<string, string | undefined> | undefined;

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

function canWriteConfig(configPath: string): boolean {
  try {
    if (existsSync(configPath)) {
      accessSync(configPath, fsConstants.W_OK);
    } else {
      mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
      accessSync(dirname(configPath), fsConstants.R_OK | fsConstants.W_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function persistGeneratedSecrets(
  configPath: string,
  fileConfig: Record<string, unknown>,
  secrets: Record<string, string>,
): void {
  const nextConfig = { ...fileConfig, ...secrets };
  writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, {
    mode: 0o600,
  });
  chmodSync(configPath, 0o600);
}

export function loadRuntimeConfig(): Record<string, string | undefined> {
  if (loadedConfig) return loadedConfig;

  loadDotenv({ quiet: true });

  const configPath = resolve(
    process.cwd(),
    process.env.CONFIG_PATH || './data/config.json',
  );
  const fileConfig = readConfigFile(configPath);
  const merged: Record<string, string | undefined> = {};

  for (const [key, defaultValue] of Object.entries(DEFAULTS)) {
    const fileValue = fileConfig[key];
    merged[key] =
      process.env[key] ??
      (typeof fileValue === 'string' || typeof fileValue === 'number'
        ? String(fileValue)
        : defaultValue);
  }

  const secretKeys = [
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'WORKER_SECRET',
  ];
  const missingSecretKeys = secretKeys.filter((key) => !merged[key]);
  const generatedSecrets: Record<string, string> = {};

  if (missingSecretKeys.length > 0 && canWriteConfig(configPath)) {
    for (const key of missingSecretKeys) {
      const secret = randomBytes(48).toString('hex');
      merged[key] = secret;
      generatedSecrets[key] = secret;
    }
  } else if (missingSecretKeys.length > 0) {
    console.warn(
      'Runtime config is not writable; automatic secret generation was skipped.',
    );
  }

  if (Object.keys(generatedSecrets).length > 0) {
    persistGeneratedSecrets(configPath, fileConfig, generatedSecrets);
  }

  loadedConfig = merged;
  return loadedConfig;
}
