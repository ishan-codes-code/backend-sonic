import { HttpService } from '@nestjs/axios';
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { SongCatalogService } from './song-catalog.service';
import { SongStreamService } from './song-stream.service';
import { toSongDto } from './dto/play-response.dto';
import { WorkerCallbackDto } from './dto/song.dto';

export interface ProcessJobData {
  youtubeId: string;
  songId?: string;
  trackName: string;
  artistName: string;
  youtubeTitle: string;
  image?: string | null;
  externalId?: string;
  lastfmId?: string;
  normalizedTrackName: string;
  normalizedArtistName: string;
  /** Injected by the API — the worker POSTs a callback to this URL on job completion or failure. */
  webhookUrl?: string;
}


@Injectable()
export class SongJobsService {
  private readonly logger = new Logger(SongJobsService.name);
  private readonly failedJobsById = new Set<string>();
  private readonly failedJobKeys = new Set<string>();
  private readonly pendingJobKeys = new Map<string, string>();
  private readonly pendingJobs = new Map<string, ProcessJobData>();
  private readonly busyJobs = new Map<
    string,
    {
      data: ProcessJobData;
      retryAfter: number;
      expiresAt: number;
      workerFetchStatus: boolean;
    }
  >();

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly songCatalogService: SongCatalogService,
    private readonly songStreamService: SongStreamService,
  ) { }

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

    // Resolve the callback URL so the worker can notify the API when the job is done.
    const callbackUrl =
      this.configService.get<string>('API_CALLBACK_URL') ??
      'http://localhost:3000/song/worker-callback';

    const payload: ProcessJobData = { ...data, webhookUrl: callbackUrl };
    const requestUrl = `${workerUrl.replace(/\/$/, '')}/process`;

    void lastValueFrom(
      this.httpService.post(requestUrl, payload, {
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
          error?.message,
          error?.response?.data,
        );
        if (error?.response?.status === 429) {
          const retryAfter = error.response?.data?.retryAfter || 15;
          this.logger.warn(
            `Worker is busy. Retry after ${retryAfter} seconds for youtubeId=${data.youtubeId}`,
          );
          this.busyJobs.set(data.youtubeId, {
            data,
            retryAfter,
            expiresAt: Date.now() + retryAfter * 1000,
            workerFetchStatus: false, // throttled immediately for the initial wait duration
          });
          this.pendingJobs.delete(data.youtubeId);
          this.pendingJobKeys.delete(data.youtubeId);
        } else {
          // If we couldn't even reach the worker or hit a hard error, clean up so the client doesn't wait forever.
          this.markFailedJob(data.youtubeId);
        }
      });

    return { youtubeId: data.youtubeId };
  }

  /**
   * Checks if there is a cached busy job for the given track and artist names.
   * Allows reusing previously resolved YouTube metadata to save API search quota.
   */
  getBusyJobByNames(track: string, artist: string): ProcessJobData | null {
    const targetKey = this.getJobKey(track, artist);
    for (const [youtubeId, busyInfo] of this.busyJobs.entries()) {
      const jobKey = this.getJobKey(
        busyInfo.data.normalizedTrackName,
        busyInfo.data.normalizedArtistName,
      );
      if (jobKey === targetKey) {
        return busyInfo.data;
      }
    }
    return null;
  }

  /**
   * Handles an incoming webhook callback from the worker.
   * Updates in-memory tracking state so subsequent getJobStatus() calls
   * are served instantly without any outbound HTTP or DB queries.
   */
  handleWorkerCallback(dto: WorkerCallbackDto): void {
    const { youtubeId, status, error } = dto;

    // Safety cleanup: delete from busyJobs if the webhook successfully arrived early
    this.busyJobs.delete(youtubeId);

    if (!this.pendingJobs.has(youtubeId)) {
      this.logger.warn(
        `Received worker callback for unknown/already-resolved job youtubeId=${youtubeId}`,
      );
      return;
    }

    if (status === 'completed') {
      this.logger.log(`Worker callback: job COMPLETED for youtubeId=${youtubeId}`);
      this.markCompletedJob(youtubeId);
    } else {
      this.logger.error(
        `Worker callback: job FAILED for youtubeId=${youtubeId} — ${error ?? 'unknown error'}`,
      );
      this.markFailedJob(youtubeId);
    }
  }

  /**
   * Returns the current status of a job.
   * 99% of calls are served from in-memory state (O(1)) with no outbound HTTP.
   * DB is only queried once the webhook signals job completion.
   */
  async getJobStatus(youtubeId: string) {
    const busyInfo = this.busyJobs.get(youtubeId);
    if (busyInfo) {
      if (busyInfo.expiresAt > Date.now()) {
        const remainingSec = Math.ceil((busyInfo.expiresAt - Date.now()) / 1000);
        return {
          status: 'busy',
          retryAfter: Math.max(1, remainingSec),
          song: null,
        };
      } else {
        // The retry-after duration has passed, but we still haven't received the webhook!
        // Unlock fetching status from the worker.
        if (busyInfo.workerFetchStatus === false) {
          busyInfo.workerFetchStatus = true;
        }

        if (busyInfo.workerFetchStatus) {
          // Block subsequent checks immediately to prevent spamming the worker status endpoint
          busyInfo.workerFetchStatus = false;

          try {
            const workerUrl = this.configService.get<string>('WORKER_URL');
            const workerSecret = this.configService.get<string>('WORKER_SECRET');

            if (workerUrl && workerSecret) {
              const url = `${workerUrl.replace(/\/$/, '')}/status/${youtubeId}`;
              this.logger.log(
                `Querying worker status for youtubeId=${youtubeId} at ${url}`,
              );

              const response = await lastValueFrom(
                this.httpService.get(url, {
                  headers: {
                    'x-worker-secret': workerSecret,
                  },
                }),
              );

              const data = response.data;
              if (data.status === 'waiting') {
                const newRetry = data.retryAfter || 15;
                this.logger.log(
                  `Worker reported job is still waiting. Updating retryAfter=${newRetry}s`,
                );
                
                busyInfo.retryAfter = newRetry;
                busyInfo.expiresAt = Date.now() + newRetry * 1000;
                busyInfo.workerFetchStatus = false; // Throttled again until this new duration expires

                return {
                  status: 'busy',
                  retryAfter: newRetry,
                  song: null,
                };
              } else if (data.status === 'active') {
                this.logger.log(
                  `Worker reported job is now active. Transitioning state.`,
                );
                this.busyJobs.delete(youtubeId);

                // Re-register it in pendingJobs on the API!
                const cachedData = busyInfo.data;
                if (cachedData && !this.pendingJobs.has(youtubeId)) {
                  this.pendingJobs.set(youtubeId, cachedData);
                  const normalizedKey = this.getJobKey(
                    cachedData.normalizedTrackName,
                    cachedData.normalizedArtistName,
                  );
                  this.pendingJobKeys.set(youtubeId, normalizedKey);
                }

                return {
                  status: 'active',
                  song: null,
                };
              } else if (data.status === 'failed') {
                this.logger.error(`Worker reported job failed.`);
                this.busyJobs.delete(youtubeId);
                this.markFailedJob(youtubeId);
                return {
                  status: 'failed',
                  song: null,
                };
              } else if (data.status === 'not_found') {
                this.logger.warn(
                  `Worker reported job not found. Deleting from busyJobs.`,
                );
                this.busyJobs.delete(youtubeId);
              }
            }
          } catch (err) {
            this.logger.error(
              `Failed to query status from worker for youtubeId=${youtubeId}`,
              err,
            );
            // Allow another fetch on the next poll check if it failed due to a transient network error
            busyInfo.workerFetchStatus = true;
          }
        }
      }
    }

    // ── 1. Check for known failure (instant, memory-only) ────────────────────
    if (this.failedJobsById.has(youtubeId)) {
      return { status: 'failed', song: null };
    }

    // ── 2. Check for active/pending job (instant, memory-only) ───────────────
    if (this.pendingJobs.has(youtubeId)) {
      return { status: 'active', song: null };
    }

    // ── 3. Not in memory: job was completed (webhook fired & cleaned up)
    //       or this is an unknown ID. Check DB as the final source of truth. ──
    const song = await this.songCatalogService.findByYoutubeId(youtubeId);
    if (song?.r2Key) {
      const streamUrl = await this.songStreamService.tryGetStreamUrl(song.r2Key);
      if (streamUrl) {
        return { status: 'completed', song: toSongDto(song) };
      }
    }

    return { status: 'not_found', song: null };
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

    const pendingKey = this.pendingJobKeys.get(youtubeId);
    if (pendingKey) {
      this.failedJobKeys.add(pendingKey);
      this.pendingJobKeys.delete(youtubeId);
    }
  }

  private markCompletedJob(youtubeId: string) {
    this.pendingJobs.delete(youtubeId);
    this.pendingJobKeys.delete(youtubeId);
  }

  private getJobKey(track: string, artist: string) {
    return `${track}::${artist}`;
  }
}
