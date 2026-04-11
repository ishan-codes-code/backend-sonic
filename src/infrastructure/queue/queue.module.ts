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
      useFactory: (configService: ConfigService) => {
        const url = configService.get<string>('redis.url');

        if (!url) {
          throw new Error('REDIS_URL is not defined');
        }
        return new IORedis(url, {
          maxRetriesPerRequest: null,
          tls: {}, // 🔥 REQUIRED for Upstash
        });
      }
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
export class QueueModule { }
