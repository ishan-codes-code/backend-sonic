import { Module } from '@nestjs/common';
import { ListeningController } from './listening.controller';
import { ListeningService } from './listening.service';

@Module({
  controllers: [ListeningController],
  providers: [ListeningService],
  exports: [ListeningService],
})
export class ListeningModule {}
