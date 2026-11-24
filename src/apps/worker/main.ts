import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AllExceptionsFilter } from '../../infrastructure/common/filters/all-exceptions.filter';
import configuration from '../../infrastructure/config/configuration';
import {
  loadRuntimeConfig,
  reloadRuntimeConfig,
  type RuntimeConfig,
} from '../../infrastructure/config/runtime-config';
import { WorkerHealthModule } from './worker-health.module';
import { WorkerHealthService } from './worker-health.service';
import {
  getWorkerRuntimeState,
  isDatabaseAvailable,
  waitForWorkerReadiness,
  WorkerRuntimeState,
} from './worker-runtime';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    WorkerHealthModule,
  ],
})
class WorkerWaitingModule {}

function logStateChange(state: WorkerRuntimeState): void {
  const message =
    state === 'waiting-for-config'
      ? 'Worker waiting for DATABASE_URL, WORKER_SECRET, and database connectivity.'
      : 'Worker configuration and database are ready.';
  console.log(message);
}

function configureHttp(app: Awaited<ReturnType<typeof NestFactory.create>>) {
  const configService = app.get(ConfigService);
  app.use(helmet());

  const allowedOrigins = configService.get<string>('WORKER_CORS_ORIGIN')
    ? configService
        .get<string>('WORKER_CORS_ORIGIN')!
        .split(',')
        .map((origin) => origin.trim())
    : false;

  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'X-Worker-Secret'],
    credentials: false,
  });
  app.useGlobalFilters(new AllExceptionsFilter());
  return configService;
}

function hasRestartRequiredChanges(
  previous: RuntimeConfig,
  current: RuntimeConfig,
): boolean {
  return Object.keys(previous).some(
    (key) => key !== 'WORKER_SECRET' && previous[key] !== current[key],
  );
}

function monitorWorker(
  configService: ConfigService,
  healthService: WorkerHealthService,
  initialConfig: RuntimeConfig,
): void {
  let checking = false;
  setInterval(() => {
    if (checking) return;
    checking = true;
    void (async () => {
      try {
        const current = reloadRuntimeConfig({ readOnly: true });
        if (hasRestartRequiredChanges(initialConfig, current)) {
          console.log('Worker configuration changed; restarting worker.');
          process.exit(0);
          return;
        }

        configService.set('WORKER_SECRET', current.WORKER_SECRET);
        const databaseAvailable = await isDatabaseAvailable(current);
        const state = getWorkerRuntimeState(current, databaseAvailable);
        if (healthService.getState() !== state) {
          logStateChange(state);
          healthService.setState(state);
        }
      } catch (error) {
        console.error('Worker configuration reload failed:', error);
      } finally {
        checking = false;
      }
    })();
  }, 5000).unref();
}

async function bootstrap(): Promise<void> {
  loadRuntimeConfig({ readOnly: true });
  const waitingApp = await NestFactory.create(WorkerWaitingModule);
  const waitingConfig = configureHttp(waitingApp);
  const port = Number(waitingConfig.get<string>('WORKER_PORT') ?? 3001);
  const healthService = waitingApp.get(WorkerHealthService);
  await waitingApp.listen(port);
  console.log(`Worker health server listening on port ${port}`);

  const readyConfig = await waitForWorkerReadiness(
    () => reloadRuntimeConfig({ readOnly: true }),
    isDatabaseAvailable,
    (state) => {
      logStateChange(state);
      healthService.setState(state);
    },
    5000,
  );

  await waitingApp.close();
  const { WorkerModule } = await import('./worker.module.js');
  const app = await NestFactory.create(WorkerModule);
  const configService = configureHttp(app);
  const activeHealthService = app.get(WorkerHealthService);
  activeHealthService.setState('ok');
  await app.listen(port);
  console.log(`Worker HTTP server listening on port ${port}`);
  monitorWorker(configService, activeHealthService, readyConfig);
}

void bootstrap().catch((error: unknown) => {
  console.error('Worker startup failed:', error);
  process.exitCode = 1;
});
