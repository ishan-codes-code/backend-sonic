import { createConnection } from 'net';
import { connect as connectTls } from 'tls';
import { neon } from '@neondatabase/serverless';
import type { RuntimeConfig } from '../../infrastructure/config/runtime-config';

export type WorkerRuntimeState = 'waiting-for-config' | 'ok' | 'redis-down';

export function getWorkerRuntimeState(
  config: RuntimeConfig,
  redisAvailable: boolean,
  databaseAvailable = true,
): WorkerRuntimeState {
  if (!config.DATABASE_URL || !config.WORKER_SECRET || !databaseAvailable) {
    return 'waiting-for-config';
  }
  return redisAvailable ? 'ok' : 'redis-down';
}

export function isWorkerConfigured(config: RuntimeConfig): boolean {
  return Boolean(config.DATABASE_URL && config.WORKER_SECRET);
}

export async function isRedisAvailable(
  config: RuntimeConfig,
  timeoutMs = 1000,
): Promise<boolean> {
  let host = config.REDIS_HOST || '127.0.0.1';
  let port = Number(config.REDIS_PORT || 6379);
  let useTls = false;
  let username: string | undefined;
  let password: string | undefined;

  if (config.REDIS_URL) {
    try {
      const redisUrl = new URL(config.REDIS_URL);
      if (!['redis:', 'rediss:'].includes(redisUrl.protocol)) return false;
      useTls = redisUrl.protocol === 'rediss:';
      host = redisUrl.hostname;
      port = Number(redisUrl.port || 6379);
      username = redisUrl.username
        ? decodeURIComponent(redisUrl.username)
        : undefined;
      password = redisUrl.password
        ? decodeURIComponent(redisUrl.password)
        : undefined;
    } catch {
      return false;
    }
  }

  return new Promise((resolve) => {
    const socket = useTls
      ? connectTls({ host, port, servername: host })
      : createConnection({ host, port });
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);

    socket.once(useTls ? 'secureConnect' : 'connect', () => {
      const commands: string[][] = [];
      if (password) {
        commands.push(
          username ? ['AUTH', username, password] : ['AUTH', password],
        );
      }
      commands.push(['PING']);
      socket.write(
        commands
          .map(
            (parts) =>
              `*${parts.length}\r\n${parts.map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join('')}`,
          )
          .join(''),
      );
    });
    socket.on('data', (data: Buffer) => {
      if (data.includes(Buffer.from('+PONG\r\n'))) {
        clearTimeout(timeout);
        socket.destroy();
        resolve(true);
      } else if (
        data.includes(Buffer.from('-ERR')) ||
        data.includes(Buffer.from('-NOAUTH'))
      ) {
        clearTimeout(timeout);
        socket.destroy();
        resolve(false);
      }
    });
    socket.once('error', () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve(false);
    });
  });
}

export async function isDatabaseAvailable(
  config: RuntimeConfig,
  timeoutMs = 3000,
): Promise<boolean> {
  if (!config.DATABASE_URL) return false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const query = neon(config.DATABASE_URL);
    await Promise.race([
      query`select 1`,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Database readiness check timed out')),
          timeoutMs,
        );
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function waitForWorkerReadiness(
  loadConfig: () => RuntimeConfig,
  probeRedis: (config: RuntimeConfig) => Promise<boolean>,
  onStateChange: (state: WorkerRuntimeState) => void,
  intervalMs = 5000,
  probeDatabase: (config: RuntimeConfig) => Promise<boolean> = () =>
    Promise.resolve(true),
): Promise<RuntimeConfig> {
  let previousState: WorkerRuntimeState | undefined;

  while (true) {
    const config = loadConfig();
    const [redisAvailable, databaseAvailable] = await Promise.all([
      probeRedis(config),
      isWorkerConfigured(config)
        ? probeDatabase(config)
        : Promise.resolve(false),
    ]);
    const state = getWorkerRuntimeState(
      config,
      redisAvailable,
      databaseAvailable,
    );
    if (state !== previousState) {
      onStateChange(state);
      previousState = state;
    }
    if (state === 'ok') return config;

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
