import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from '../../infrastructure/config/configuration';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { QueueModule } from '../../infrastructure/queue/queue.module';
import { SongProcessorModule } from './song-processor/song-processor.module';
import { SongWorkerService } from './song-worker.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    DatabaseModule,
    QueueModule,
    SongProcessorModule,
  ],
  providers: [SongWorkerService],
})
export class WorkerModule {}
