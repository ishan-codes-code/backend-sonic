import { Injectable } from '@nestjs/common';
import { QueueService } from '../../infrastructure/queue/queue.service';
import { SongCatalogService } from './song-catalog.service';

export interface ProcessJobData {
  youtubeId: string;
  songId?: string;
  trackName: string;
  artistName: string;
  youtubeTitle: string;
  image?: string;
  normalizedTrackName: string;
  normalizedArtistName: string;
}

@Injectable()
export class SongJobsService {
  constructor(
    private readonly queueService: QueueService,
    private readonly songCatalogService: SongCatalogService,
  ) { }

  async createProcessJob(data: ProcessJobData) {
    return this.queueService.getQueue().add('process-song', data);
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
      streamUrl: job.data?.streamUrl ?? null,
      song: job.data?.song ?? null,
    };
  }
}
