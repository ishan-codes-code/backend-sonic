import { neon } from '@neondatabase/serverless';
import type { RuntimeConfig } from '../../infrastructure/config/runtime-config';

export type WorkerRuntimeState = 'waiting-for-config' | 'ok';

export function getWorkerRuntimeState(
  config: RuntimeConfig,
  databaseAvailable: boolean,
): WorkerRuntimeState {
  if (!config.DATABASE_URL || !config.WORKER_SECRET || !databaseAvailable) {
    return 'waiting-for-config';
  }
  return 'ok';
}

export function isWorkerConfigured(config: RuntimeConfig): boolean {
  return Boolean(config.DATABASE_URL && config.WORKER_SECRET);
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
  probeDatabase: (config: RuntimeConfig) => Promise<boolean>,
  onStateChange: (state: WorkerRuntimeState) => void,
  intervalMs = 5000,
): Promise<RuntimeConfig> {
  let previousState: WorkerRuntimeState | undefined;

  while (true) {
    const config = loadConfig();
    const databaseAvailable = isWorkerConfigured(config)
      ? await probeDatabase(config)
      : false;
    const state = getWorkerRuntimeState(config, databaseAvailable);
    if (state !== previousState) {
      onStateChange(state);
      previousState = state;
    }
    if (state === 'ok') return config;

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
