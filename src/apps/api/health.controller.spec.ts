import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  API_DATABASE_HEALTH_TIMEOUT_MS,
  HealthController,
} from './health.controller';
import { WORKER_DATABASE_HEALTH_TIMEOUT_MS } from '../worker/worker-health.controller';

const DATABASE_URL = 'postgresql://user:s3cret@db.host:5432/db';

function createController(
  execute?: jest.Mock,
  values: Record<string, string | undefined> = {},
) {
  const config = { 'database.url': DATABASE_URL, ...values };
  const configService = {
    get: (key: string) => config[key],
  } as unknown as ConfigService;
  const database = execute === undefined ? undefined : { execute };
  return new HealthController(configService, database as any);
}

describe('health database timeouts', () => {
  it('uses the same 6000ms probe budget in the API and worker', () => {
    expect(API_DATABASE_HEALTH_TIMEOUT_MS).toBe(6000);
    expect(WORKER_DATABASE_HEALTH_TIMEOUT_MS).toBe(6000);
  });

  it('stays below the 8s app polling budget', () => {
    expect(API_DATABASE_HEALTH_TIMEOUT_MS).toBeLessThan(8000);
    expect(WORKER_DATABASE_HEALTH_TIMEOUT_MS).toBeLessThan(8000);
  });
});

describe('HealthController database check', () => {
  let warnings: string[];

  beforeEach(() => {
    warnings = [];
    jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((...args: unknown[]) => {
        warnings.push(args.map(String).join(' '));
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('reports ok without warning when the probe succeeds', async () => {
    const controller = createController(
      jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    );

    const res = await controller.getHealth();

    expect(res.db).toBe('ok');
    expect(warnings).toEqual([]);
  });

  it('keeps the response shape unchanged', async () => {
    const controller = createController(jest.fn().mockResolvedValue([]));

    const res = await controller.getHealth();

    expect(Object.keys(res).sort()).toEqual([
      'apiVersion',
      'app',
      'db',
      'features',
      'minAppVersion',
      'setupRequired',
      'version',
    ]);
  });

  it('reports down and warns with the reason and cause on failure', async () => {
    const failure = new Error('connect failed');
    (failure as any).cause = new Error('socket hang up');
    const controller = createController(jest.fn().mockRejectedValue(failure));

    const res = await controller.getHealth();

    expect(res.db).toBe('down');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('connect failed');
    expect(warnings[0]).toContain('socket hang up');
  });

  it('never logs the database URL or password', async () => {
    const failure = new Error(`connect failed for ${DATABASE_URL}`);
    const controller = createController(jest.fn().mockRejectedValue(failure));

    await controller.getHealth();

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('postgres://***');
    expect(warnings[0]).not.toContain('s3cret');
    expect(warnings[0]).not.toContain(DATABASE_URL);
  });

  it('reports down and warns on timeout only after the full budget', async () => {
    jest.useFakeTimers();
    const controller = createController(
      jest.fn().mockReturnValue(new Promise(() => {})),
    );

    let settled = false;
    const pending = controller.getHealth().then(
      (res) => {
        settled = true;
        return res;
      },
      (err) => {
        settled = true;
        throw err;
      },
    );

    await jest.advanceTimersByTimeAsync(API_DATABASE_HEALTH_TIMEOUT_MS - 1);
    expect(settled).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    const res = await pending;

    expect(settled).toBe(true);
    expect(res.db).toBe('down');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('timed out');
  });

  it('reports unconfigured without warning when no database is set', async () => {
    const controller = createController(undefined, {
      'database.url': undefined,
    });

    const res = await controller.getHealth();

    expect(res.db).toBe('unconfigured');
    expect(warnings).toEqual([]);
  });
});
