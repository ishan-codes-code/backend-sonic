import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { WorkerModule } from './worker.module';
import { AllExceptionsFilter } from '../../infrastructure/common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(WorkerModule);
  const port = Number(process.env.WORKER_PORT ?? 3001);

  app.use(helmet());

  const allowedOrigins = process.env.WORKER_CORS_ORIGIN
    ? process.env.WORKER_CORS_ORIGIN.split(',').map((origin) => origin.trim())
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

bootstrap();
