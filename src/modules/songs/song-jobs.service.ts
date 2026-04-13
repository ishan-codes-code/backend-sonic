import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
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
    const queue = this.queueService.getQueue();

    // 🛡️ Check for failed jobs to prevent retrying videos that consistently fail (e.g., too long)
    const failedJobs = await queue.getJobs(['failed']);
    const failedMatch = failedJobs.find(
      (j) => j.data?.youtubeId === data.youtubeId,
    );

    if (failedMatch) {
      throw new HttpException(
        `This video previously failed processing: ${failedMatch.failedReason}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // 🛡️ Check for active/waiting jobs to prevent duplicate processing
    const currentJobs = await queue.getJobs(['active', 'waiting', 'delayed']);
    const existingJob = currentJobs.find(
      (j) => j.data?.youtubeId === data.youtubeId,
    );

    if (existingJob) {
      return existingJob;
    }

    return queue.add('process-song', data);
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

  async checkFailedJobByNames(track: string, artist: string) {
    const queue = this.queueService.getQueue();
    // Fetch failed jobs to check if this query has failed before
    const failedJobs = await queue.getJobs(['failed']);
    const match = failedJobs.find(
      (j) =>
        j.data?.normalizedTrackName === track &&
        j.data?.normalizedArtistName === artist,
    );

    if (match) {
      throw new HttpException(
        `Previous attempt for "${track}" by "${artist}" failed: ${match.failedReason}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
