import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AllExceptionsFilter } from '../../infrastructure/common/filters/all-exceptions.filter';
import { loadRuntimeConfig } from '../../infrastructure/config/runtime-config';

async function bootstrap() {
  const runtimeConfig = loadRuntimeConfig();
  if (!runtimeConfig.DATABASE_URL) {
    console.log('DATABASE_URL is not set. Worker is idle.');
    return;
  }

  const { WorkerModule } = await import('./worker.module.js');
  const app = await NestFactory.create(WorkerModule);
  const configService = app.get(ConfigService);
  const port = Number(configService.get<string>('WORKER_PORT') ?? 3001);

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

  await app.listen(port);
  console.log(`Worker HTTP server listening on port ${port}`);
}

void bootstrap();
