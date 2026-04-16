import { HttpService } from '@nestjs/axios';
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { lastValueFrom } from 'rxjs';
import { SongCatalogService } from './song-catalog.service';
import { SongStreamService } from './song-stream.service';

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

type WorkerStatus = 'active' | 'failed' | 'not_found';

interface CachedWorkerStatus {
  status: WorkerStatus;
  expiresAt: number;
}

@Injectable()
export class SongJobsService {
  private readonly logger = new Logger(SongJobsService.name);
  private readonly failedJobsById = new Set<string>();
  private readonly failedJobKeys = new Set<string>();
  private readonly pendingJobKeys = new Map<string, string>();
  private readonly pendingJobs = new Map<string, ProcessJobData>();
  private readonly workerStatusCache = new Map<string, CachedWorkerStatus>();
  private readonly workerStatusCacheTTL = 4_000;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly songCatalogService: SongCatalogService,
    private readonly songStreamService: SongStreamService,
  ) {}

  async createProcessJob(data: ProcessJobData) {
    if (this.pendingJobs.has(data.youtubeId)) {
      return { youtubeId: data.youtubeId };
    }

    return this.triggerWorker(data);
  }

  async triggerWorker(data: ProcessJobData) {
    const workerUrl = this.configService.get<string>('WORKER_URL');
    const workerSecret = this.configService.get<string>('WORKER_SECRET');

    if (!workerUrl || !workerSecret) {
      throw new Error('WORKER_URL and WORKER_SECRET must be configured');
    }

    const normalizedKey = this.getJobKey(
      data.normalizedTrackName,
      data.normalizedArtistName,
    );

    if (
      this.failedJobsById.has(data.youtubeId) ||
      this.failedJobKeys.has(normalizedKey)
    ) {
      throw new HttpException(
        `This video previously failed processing: ${data.youtubeId}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (this.pendingJobs.has(data.youtubeId)) {
      return { youtubeId: data.youtubeId };
    }

    this.pendingJobKeys.set(data.youtubeId, normalizedKey);
    this.pendingJobs.set(data.youtubeId, data);
    const requestUrl = `${workerUrl.replace(/\/$/, '')}/process`;

    void lastValueFrom(
      this.httpService.post(requestUrl, data, {
        headers: {
          'content-type': 'application/json',
          'x-worker-secret': workerSecret,
        },
      }),
    )
      .then((response) => {
        if (response.status < 200 || response.status >= 300) {
          this.logger.error(
            `Worker POST /process returned ${response.status} for youtubeId=${data.youtubeId}`,
          );
        }
      })
      .catch((error) => {
        this.logger.error(
          `Failed to send worker request for youtubeId=${data.youtubeId}`,
          error,
        );
      });

    return { youtubeId: data.youtubeId };
  }

  private getCachedWorkerStatus(youtubeId: string): WorkerStatus | null {
    const cached = this.workerStatusCache.get(youtubeId);
    if (!cached || cached.expiresAt < Date.now()) {
      this.workerStatusCache.delete(youtubeId);
      return null;
    }

    return cached.status;
  }

  private setCachedWorkerStatus(youtubeId: string, status: WorkerStatus) {
    this.workerStatusCache.set(youtubeId, {
      status,
      expiresAt: Date.now() + this.workerStatusCacheTTL,
    });
  }

  private deleteWorkerStatusCache(youtubeId: string) {
    this.workerStatusCache.delete(youtubeId);
  }

  async getJobStatus(youtubeId: string) {
    if (this.failedJobsById.has(youtubeId)) {
      this.deleteWorkerStatusCache(youtubeId);
      return {
        status: 'failed',
        streamUrl: null,
        song: null,
      };
    }

    const pendingJob = this.pendingJobs.get(youtubeId);
    const cachedStatus = this.getCachedWorkerStatus(youtubeId);

    if (pendingJob && cachedStatus === 'active') {
      return {
        status: 'active',
        streamUrl: null,
        song: null,
      };
    }

    if (pendingJob && cachedStatus === 'failed') {
      this.markFailedJob(youtubeId);
      return {
        status: 'failed',
        streamUrl: null,
        song: null,
      };
    }

    if (pendingJob && cachedStatus === 'not_found') {
      return {
        status: 'waiting',
        streamUrl: null,
        song: null,
      };
    }

    if (pendingJob && !cachedStatus) {
      const song = await this.songCatalogService.findByYoutubeId(youtubeId);
      if (song) {
        const streamUrl = await this.songStreamService.tryGetStreamUrl(
          song.r2Key,
        );
        if (streamUrl) {
          this.markCompletedJob(youtubeId);
          this.deleteWorkerStatusCache(youtubeId);
          return {
            status: 'completed',
            streamUrl,
            song,
          };
        }

        return {
          status: 'active',
          streamUrl: null,
          song: null,
        };
      }

      return {
        status: 'waiting',
        streamUrl: null,
        song: null,
      };
    }

    if (!pendingJob && cachedStatus) {
      return {
        status: cachedStatus,
        streamUrl: null,
        song: null,
      };
    }

    const workerUrl = this.configService.get<string>('WORKER_URL');
    const workerSecret = this.configService.get<string>('WORKER_SECRET');

    if (!workerUrl || !workerSecret) {
      throw new Error('WORKER_URL and WORKER_SECRET must be configured');
    }

    let response;
    try {
      response = await lastValueFrom(
        this.httpService.get(
          `${workerUrl.replace(/\/$/, '')}/status/${encodeURIComponent(youtubeId)}`,
          {
          headers: {
            'x-worker-secret': workerSecret,
          },
          },
        ),
      );
    } catch (error: unknown) {
      if (error instanceof AxiosError && error.response) {
        const responseText =
          typeof error.response.data === 'string'
            ? error.response.data
            : JSON.stringify(error.response.data);
        throw new HttpException(
          `Worker status request failed: ${error.response.status} ${responseText}`,
          error.response.status,
        );
      }
      throw new HttpException(
        `Worker status request failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const body = response.data;
    if (
      !body ||
      typeof body.status !== 'string' ||
      (body.status !== 'active' &&
        body.status !== 'failed' &&
        body.status !== 'not_found')
    ) {
      throw new HttpException(
        `Unexpected worker status response: ${JSON.stringify(body)}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const status = body.status as WorkerStatus;

    this.setCachedWorkerStatus(youtubeId, status);

    if (pendingJob && status === 'not_found') {
      return {
        status: 'waiting',
        streamUrl: null,
        song: null,
      };
    }

    if (status === 'failed') {
      this.markFailedJob(youtubeId);
      return {
        status: 'failed',
        streamUrl: null,
        song: null,
      };
    }

    if (status === 'active') {
      return {
        status: 'active',
        streamUrl: null,
        song: null,
      };
    }

    const song = await this.songCatalogService.findByYoutubeId(youtubeId);
    if (song) {
      const streamUrl = await this.songStreamService.tryGetStreamUrl(
        song.r2Key,
      );
      if (streamUrl) {
        this.markCompletedJob(youtubeId);
        this.deleteWorkerStatusCache(youtubeId);
        return {
          status: 'completed',
          streamUrl,
          song,
        };
      }

      return {
        status: 'active',
        streamUrl: null,
        song: null,
      };
    }

    if (pendingJob) {
      return {
        status: 'waiting',
        streamUrl: null,
        song: null,
      };
    }

    return {
      status: 'not_found',
      streamUrl: null,
      song: null,
    };
  }

  async checkFailedJobByNames(track: string, artist: string) {
    const normalizedKey = this.getJobKey(track, artist);

    if (this.failedJobKeys.has(normalizedKey)) {
      throw new HttpException(
        `Previous attempt for "${track}" by "${artist}" failed`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private markFailedJob(youtubeId: string) {
    this.failedJobsById.add(youtubeId);
    this.pendingJobs.delete(youtubeId);
    this.deleteWorkerStatusCache(youtubeId);

    const pendingKey = this.pendingJobKeys.get(youtubeId);
    if (pendingKey) {
      this.failedJobKeys.add(pendingKey);
      this.pendingJobKeys.delete(youtubeId);
    }
  }

  private markCompletedJob(youtubeId: string) {
    this.pendingJobs.delete(youtubeId);
    this.pendingJobKeys.delete(youtubeId);
    this.deleteWorkerStatusCache(youtubeId);
  }

  private getJobKey(track: string, artist: string) {
    return `${track}::${artist}`;
  }
}
