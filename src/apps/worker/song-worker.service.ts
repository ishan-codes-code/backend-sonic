import {
  Inject,
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import {
  REDIS_CONNECTION,
  SONGS_QUEUE_NAME,
} from '../../infrastructure/queue/queue.constants';
import { SongProcessorService } from './song-processor/song-processor.service';

@Injectable()
export class SongWorkerService implements OnModuleInit, OnApplicationShutdown {
  private worker?: Worker;

  constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: IORedis,
    private readonly songProcessorService: SongProcessorService,
  ) {}

  onModuleInit() {
    const workerConnection = this.connection.duplicate();

    this.worker = new Worker(
      SONGS_QUEUE_NAME,
      async (job) => this.songProcessorService.handle(job),
      { connection: workerConnection },
    );

    this.worker.on('completed', (job) => {
      console.log(`Job completed: ${job.id}`);
    });

    this.worker.on('failed', (job, err) => {
      console.error(`Job failed: ${job?.id}`, err);
    });
  }

  async onApplicationShutdown() {
    await this.worker?.close();
  }
}
