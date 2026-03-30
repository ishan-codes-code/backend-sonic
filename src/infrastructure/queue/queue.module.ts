import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { QueueService } from './queue.service';
import {
  REDIS_CONNECTION,
  SONGS_QUEUE,
  SONGS_QUEUE_NAME,
} from './queue.constants';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CONNECTION,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        new IORedis({
          host: configService.get<string>('queue.host') ?? '127.0.0.1',
          port: configService.get<number>('queue.port') ?? 6379,
          maxRetriesPerRequest: null,
        }),
    },
    {
      provide: SONGS_QUEUE,
      inject: [REDIS_CONNECTION],
      useFactory: (connection: IORedis) =>
        new Queue(SONGS_QUEUE_NAME, {
          connection,
        }),
    },
    QueueService,
  ],
  exports: [QueueService, REDIS_CONNECTION, SONGS_QUEUE],
})
export class QueueModule {}
