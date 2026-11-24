import { Module } from '@nestjs/common';
import { WorkerHealthController } from './worker-health.controller';
import { WorkerHealthService } from './worker-health.service';

@Module({
  controllers: [WorkerHealthController],
  providers: [WorkerHealthService],
  exports: [WorkerHealthService],
})
export class WorkerHealthModule {}
