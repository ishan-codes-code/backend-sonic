import { waitForWorkerReadiness, WorkerRuntimeState } from './worker-runtime';

const readyConfig = {
  DATABASE_URL: 'postgresql://db',
  WORKER_SECRET: 'worker-secret',
};

describe('worker readiness polling', () => {
  it('waits for database configuration', async () => {
    let attempts = 0;
    const states: WorkerRuntimeState[] = [];

    await waitForWorkerReadiness(
      () => (++attempts === 1 ? {} : readyConfig),
      () => Promise.resolve(true),
      (state) => states.push(state),
      1,
    );

    expect(states).toEqual(['waiting-for-config', 'ok']);
  });

  it('waits for the worker secret', async () => {
    let attempts = 0;
    const states: WorkerRuntimeState[] = [];

    await waitForWorkerReadiness(
      () =>
        ++attempts === 1
          ? { DATABASE_URL: readyConfig.DATABASE_URL }
          : readyConfig,
      () => Promise.resolve(true),
      (state) => states.push(state),
      1,
    );

    expect(states).toEqual(['waiting-for-config', 'ok']);
  });

  it('waits until the configured database is reachable', async () => {
    let databaseChecks = 0;
    const states: WorkerRuntimeState[] = [];

    await waitForWorkerReadiness(
      () => readyConfig,
      () => Promise.resolve(++databaseChecks > 1),
      (state) => states.push(state),
      1,
    );

    expect(databaseChecks).toBe(2);
    expect(states).toEqual(['waiting-for-config', 'ok']);
  });

  it('becomes ready with only database and worker secret configuration', async () => {
    const states: WorkerRuntimeState[] = [];
    const result = await waitForWorkerReadiness(
      () => readyConfig,
      () => Promise.resolve(true),
      (state) => states.push(state),
      1,
    );

    expect(result).toBe(readyConfig);
    expect(states).toEqual(['ok']);
  });
});
