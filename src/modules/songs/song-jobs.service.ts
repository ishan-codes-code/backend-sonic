import { Injectable } from '@nestjs/common';
import { QueueService } from '../../infrastructure/queue/queue.service';
import { SongDto } from './dto/song.dto';

@Injectable()
export class SongJobsService {
  constructor(private readonly queueService: QueueService) {}

  async createPlayJob(songDto: SongDto) {
    return this.queueService.getQueue().add('play-song', {
      ...songDto,
    });
  }

  async getJobStatus(jobId: string) {
    const job = await this.queueService.getQueue().getJob(jobId);

    if (!job) {
      throw new Error('Job not found');
    }

    const state = await job.getState();

    return {
      status: state,
      progress: job.progress,
      streamUrl: job.data?.streamUrl,
    };
  }
}
