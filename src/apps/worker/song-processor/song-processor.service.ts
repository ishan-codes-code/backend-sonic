import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { SongCatalogService } from '../../../modules/song/song-catalog.service';
import { SongFilesService } from '../../../modules/song/song-files.service';
import { SongStreamService } from '../../../modules/song/song-stream.service';
import { ProcessJobData } from '../../../modules/song/song-jobs.service';
import { ArtistService } from '../../../modules/song/artist.service';
import { splitArtists } from '../../../shared/utils/artist.utils';

export interface QueueItem {
  data: ProcessJobData;
  status: 'active' | 'waiting';
  startedAt?: number;
}

@Injectable()
export class SongProcessorService {
  private readonly logger = new Logger(SongProcessorService.name);
  private readonly queue: QueueItem[] = [];
  private readonly failedJobs = new Set<string>();
  private readonly JOB_TIMEOUT_MS = 60_000;

  constructor(
    private readonly songFilesService: SongFilesService,
    private readonly songCatalogService: SongCatalogService,
    private readonly songStreamService: SongStreamService,
    private readonly artistService: ArtistService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) { }

  getRetryAfterForJob(youtubeId: string): number {
    const index = this.queue.findIndex((item) => item.data.youtubeId === youtubeId);
    if (index === -1) return 15;

    const activeItem = this.queue.find((item) => item.status === 'active');
    let remainingActiveMs = this.JOB_TIMEOUT_MS;
    if (activeItem && activeItem.startedAt) {
      remainingActiveMs = Math.max(
        0,
        this.JOB_TIMEOUT_MS - (Date.now() - activeItem.startedAt),
      );
    }

    // Positions index: active is index 0. If this job is at index > 0, there are (index - 1) waiting jobs in front of it.
    const waitingInFront = Math.max(0, index - 1);
    const queuedJobsTimeMs = waitingInFront * 45_000;
    const totalRemainingSec = Math.ceil(
      (remainingActiveMs + queuedJobsTimeMs) / 1000,
    );
    return Math.max(5, Math.min(600, totalRemainingSec));
  }

  async handle(data: ProcessJobData): Promise<{ status: 'active' | 'waiting'; retryAfter?: number }> {
    this.logger.log(`Received handle request for youtubeId=${data.youtubeId}`);

    if (this.failedJobs.has(data.youtubeId)) {
      throw new Error(`Previously failed youtubeId=${data.youtubeId}`);
    }

    const existing = this.queue.find((item) => item.data.youtubeId === data.youtubeId);
    if (existing) {
      this.logger.log(
        `Already in queue with status=${existing.status} for youtubeId=${data.youtubeId}`,
      );
      if (existing.status === 'waiting') {
        return {
          status: 'waiting',
          retryAfter: this.getRetryAfterForJob(data.youtubeId),
        };
      }
      return { status: 'active' };
    }

    const activeItem = this.queue.find((item) => item.status === 'active');
    if (!activeItem) {
      // Queue is empty: start processing immediately!
      const item: QueueItem = {
        data,
        status: 'active',
        startedAt: Date.now(),
      };
      this.queue.push(item);
      
      // Execute asynchronously so the HTTP POST response returns immediately
      void this.executeJobWithTimeout(data);
      return { status: 'active' };
    } else {
      // An active job is running: append as waiting
      const item: QueueItem = {
        data,
        status: 'waiting',
      };
      this.queue.push(item);

      const retryAfter = this.getRetryAfterForJob(data.youtubeId);
      this.logger.log(
        `Queued youtubeId=${data.youtubeId} with status 'waiting'. retryAfter=${retryAfter} seconds`,
      );
      return { status: 'waiting', retryAfter };
    }
  }

  private async executeJobWithTimeout(data: ProcessJobData): Promise<void> {
    let timeoutHandle: NodeJS.Timeout | null = null;

    try {
      await Promise.race([
        this.processJob(data),
        new Promise<void>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error('Job timed out')),
            this.JOB_TIMEOUT_MS,
          );
        }),
      ]);

      this.logger.log(`Processing completed youtubeId=${data.youtubeId}`);

      if (data.webhookUrl) {
        const workerSecret = this.configService.get<string>('WORKER_SECRET');
        void lastValueFrom(
          this.httpService.post(
            data.webhookUrl,
            {
              youtubeId: data.youtubeId,
              status: 'completed',
            },
            {
              headers: {
                'x-worker-secret': workerSecret,
              },
            },
          ),
        ).catch((err) => {
          this.logger.error(
            `Failed to send success webhook to ${data.webhookUrl}`,
            err?.response?.data || err?.message,
          );
        });
      }
    } catch (error) {
      if ((error as Error).message === 'Job timed out') {
        this.logger.error(
          `Processing timed out for youtubeId=${data.youtubeId}`,
        );
      }

      this.failedJobs.add(data.youtubeId);
      this.logger.error(`Processing failed youtubeId=${data.youtubeId}`, error);

      if (data.webhookUrl) {
        const workerSecret = this.configService.get<string>('WORKER_SECRET');
        void lastValueFrom(
          this.httpService.post(
            data.webhookUrl,
            {
              youtubeId: data.youtubeId,
              status: 'failed',
              error: (error as Error).message || 'Unknown processing error',
            },
            {
              headers: {
                'x-worker-secret': workerSecret,
              },
            },
          ),
        ).catch((err) => {
          this.logger.error(
            `Failed to send failure webhook to ${data.webhookUrl}`,
            err?.response?.data || err?.message,
          );
        });
      }
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      
      // Remove completed/failed job from the queue
      const idx = this.queue.findIndex((i) => i.data.youtubeId === data.youtubeId);
      if (idx !== -1) {
        this.queue.splice(idx, 1);
      }

      // Automatically pick up next waiting job in the queue
      const nextItem = this.queue.find((i) => i.status === 'waiting');
      if (nextItem) {
        nextItem.status = 'active';
        nextItem.startedAt = Date.now();
        void this.executeJobWithTimeout(nextItem.data);
      }
    }
  }

  getQueueStatus(youtubeId: string): { status: 'active' | 'waiting' | 'failed' | 'not_found'; retryAfter?: number } {
    if (this.failedJobs.has(youtubeId)) {
      return { status: 'failed' };
    }

    const item = this.queue.find((i) => i.data.youtubeId === youtubeId);
    if (item) {
      if (item.status === 'active') {
        return { status: 'active' };
      } else {
        return {
          status: 'waiting',
          retryAfter: this.getRetryAfterForJob(youtubeId),
        };
      }
    }

    return { status: 'not_found' };
  }

  private async processJob(data: ProcessJobData): Promise<void> {
    const { youtubeId } = data;

    // Step 1: Check if song already has an r2Key (may have been processed already)
    let song = await this.songCatalogService.findByYoutubeId(youtubeId);

    if (song?.r2Key) {
      const streamUrl = await this.songStreamService.tryGetStreamUrl(
        song.r2Key,
      );
      if (streamUrl) {
        this.logger.log(`Song already available for youtubeId=${youtubeId}`);
        return;
      }
    }

    // Step 2: Download audio and upload to R2
    this.logger.log(`Downloading audio for youtubeId=${youtubeId}`);
    const result = await this.songFilesService.downloadAudio(youtubeId);

    // Step 3: Create or update DB record
    try {
      song = await this.songCatalogService.create({
        youtubeId,
        trackName: data.trackName,
        normalizedTrackName: data.normalizedTrackName,
        youtubeTitle: data.youtubeTitle,
        image: data.image ?? null,
        externalId: data.externalId ?? null,
        lastfmId: data.lastfmId ?? null,
        r2Key: result.r2Key,
        duration: result.duration,
      });
    } catch (err: any) {
      if (err.message?.includes('duplicate key value')) {
        song = await this.songCatalogService.updateR2Key(
          youtubeId,
          result.r2Key,
          result.duration,
        );
      } else {
        throw err;
      }
    }

    // Phase 4 Dual-Write: Link artists to the song in the new relational tables
    if (song) {
      const names = splitArtists(data.artistName);
      await this.artistService.linkArtistsToSong(song.id, names);
    }

    if (!song) {
      throw new Error(
        `Song record not found after processing (youtubeId=${youtubeId})`,
      );
    }

    const streamUrl = await this.songStreamService.tryGetStreamUrl(song.r2Key!);

    if (!streamUrl) {
      throw new Error(`Failed to generate stream URL for r2Key=${song.r2Key}`);
    }

    this.logger.log(
      `Song processing finished for youtubeId=${youtubeId} | songId=${song.id}`,
    );
  }
}
