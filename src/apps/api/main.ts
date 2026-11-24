import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AllExceptionsFilter } from '../../infrastructure/common/filters/all-exceptions.filter';
import { loadRuntimeConfig } from '../../infrastructure/config/runtime-config';

async function bootstrap() {
  const runtimeConfig = loadRuntimeConfig();
  const setupRequired = !runtimeConfig.DATABASE_URL;
  const isProd = runtimeConfig.NODE_ENV === 'production';

  if (setupRequired) {
    console.log('Setup required. Waiting for app to configure.');
  }

  const { ApiModule } = setupRequired
    ? { ApiModule: (await import('./setup.module.js')).SetupModule }
    : { ApiModule: (await import('./api.module.js')).ApiModule };

  const app = await NestFactory.create(ApiModule, {
    logger: isProd
      ? ['log', 'error', 'warn']
      : ['log', 'error', 'warn', 'debug', 'verbose'],
  });

  const configService = app.get(ConfigService);
  app.use(helmet());

  const allowedOrigins = configService.get<string>('API_CORS_ORIGIN')
    ? configService
        .get<string>('API_CORS_ORIGIN')!
        .split(',')
        .map((origin) => origin.trim())
    : undefined;

  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Id'],
    credentials: true,
  });

  app.useGlobalFilters(new AllExceptionsFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.listen(configService.get<number>('port') ?? 3000);
}
void bootstrap();
