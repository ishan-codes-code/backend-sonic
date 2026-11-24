import { waitForWorkerReadiness, WorkerRuntimeState } from './worker-runtime';

describe('worker readiness polling', () => {
  it('continues waiting without database configuration and resolves when ready', async () => {
    let attempts = 0;
    const states: WorkerRuntimeState[] = [];
    const readyConfig = {
      DATABASE_URL: 'postgresql://db',
      WORKER_SECRET: 'worker-secret',
    };

    const result = await waitForWorkerReadiness(
      () => {
        attempts += 1;
        return attempts === 1 ? {} : readyConfig;
      },
      () => Promise.resolve(attempts > 1),
      (state) => states.push(state),
      1,
    );

    expect(attempts).toBe(2);
    expect(result).toBe(readyConfig);
    expect(states).toEqual(['waiting-for-config', 'ok']);
  });
});
