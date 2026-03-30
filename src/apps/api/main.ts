import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { ApiModule } from './api.module';
import { AllExceptionsFilter } from '../../infrastructure/common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(ApiModule);

  app.use(helmet());
  app.enableCors();

  app.useGlobalFilters(new AllExceptionsFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
