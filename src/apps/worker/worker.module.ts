import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from '../../infrastructure/config/configuration';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { SongProcessorModule } from './song-processor/song-processor.module';
import { WorkerController } from './worker.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    DatabaseModule,
    SongProcessorModule,
  ],
  controllers: [WorkerController],
})
export class WorkerModule {}
