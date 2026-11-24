import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import configuration from '../../infrastructure/config/configuration';
import { HealthController } from './health.controller';
import { SetupController } from './setup.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]),
  ],
  controllers: [HealthController, SetupController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class SetupModule {}
