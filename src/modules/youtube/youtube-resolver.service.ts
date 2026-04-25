import {
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  HttpException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { normalizeString } from '../../shared/utils/string.utils';
import { YoutubeScorerService } from './youtube-scorer.service';
import {
  YoutubeSearchResponse,
  YoutubeSearchItem,
  ResolvedYoutubeSong,
} from './youtube.types';

@Injectable()
export class YoutubeResolverService {
  private readonly logger = new Logger(YoutubeResolverService.name);

  // 🛡️ Deduplication: Store in-flight promises to prevent multiple calls for same song
  private resolvingRequests = new Map<string, Promise<ResolvedYoutubeSong>>();

  // 🔒 Quota state: if true, we stick to the backup key
  private useBackup = false;
  private lastQuotaReset = Date.now();

  constructor(
    private readonly httpService: HttpService,
    private readonly scorer: YoutubeScorerService,
  ) { }

  // ─── API Key Management ──────────────────────────────────────────────────────

  private getApiKey(): string {
    const isDev = process.env.NODE_ENV === 'development';
    if (isDev && process.env.YOUTUBE_API_KEY_DEV) {
      return process.env.YOUTUBE_API_KEY_DEV;
    }

    const twentyFourHours = 24 * 60 * 60 * 1000;
    if (this.useBackup && Date.now() - this.lastQuotaReset > twentyFourHours) {
      this.logger.log('Resetting YouTube API key to primary (24h passed)');
      this.useBackup = false;
    }

    if (this.useBackup && process.env.YOUTUBE_API_KEY_BACKUP) {
      this.logger.warn('Using BACKUP API key (Quota exceeded fallback active)');
      return process.env.YOUTUBE_API_KEY_BACKUP;
    }

    return (
      process.env.YOUTUBE_API_KEY_PROD || process.env.YOUTUBE_API_KEY || ''
    );
  }

  private isQuotaError(error: any): boolean {
    const reason = error?.response?.data?.error?.errors?.[0]?.reason;
    return reason === 'quotaExceeded' || reason === 'dailyLimitExceeded';
  }

  public isQuotaExhausted(): boolean {
    if (!this.useBackup) return false;
    const twentyFourHours = 24 * 60 * 60 * 1000;
    return Date.now() - this.lastQuotaReset < twentyFourHours;
  }

  // ─── Public Resolution ───────────────────────────────────────────────────────

  async resolveFromTrackAndArtist(
    trackName: string,
    artistName: string,
  ): Promise<ResolvedYoutubeSong> {
    const cacheKey = `${trackName}:${artistName}`.toLowerCase().trim();

    if (this.resolvingRequests.has(cacheKey)) {
      this.logger.log(`Deduplicating in-flight request for: ${cacheKey}`);
      return this.resolvingRequests.get(cacheKey)!;
    }

    const resolutionPromise = (async () => {
      try {
        return await this.performResolution(trackName, artistName);
      } finally {
        this.resolvingRequests.delete(cacheKey);
      }
    })();

    this.resolvingRequests.set(cacheKey, resolutionPromise);
    return resolutionPromise;
  }

  // ─── Internal Resolution ─────────────────────────────────────────────────────

  private async performResolution(
    trackName: string,
    artistName: string,
  ): Promise<ResolvedYoutubeSong> {
    const normalizedTrackName = normalizeString(trackName);
    const normalizedArtistName = normalizeString(artistName);

    try {
      return await this.fetchWithRetry(
        trackName,
        artistName,
        normalizedTrackName,
        normalizedArtistName,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;

      if (this.isQuotaError(error)) {
        this.logger.error('CRITICAL: All YouTube API Quotas exhausted!');
        throw new HttpException(
          'Music resolution service is currently at capacity. Please try again tomorrow.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      this.logger.error('YouTube resolution failed', error);
      throw new InternalServerErrorException(
        'Failed to resolve YouTube video for playback',
      );
    }
  }

  private async fetchWithRetry(
    trackName: string,
    artistName: string,
    normalizedTrackName: string,
    normalizedArtistName: string,
  ): Promise<ResolvedYoutubeSong> {
    const currentKey = this.getApiKey();

    const makeRequest = async (key: string, query: string) =>
      lastValueFrom(
        this.httpService.get<YoutubeSearchResponse>(
          'https://www.googleapis.com/youtube/v3/search',
          {
            params: {
              key,
              part: 'snippet',
              type: 'video',
              maxResults: 10,
              videoCategoryId: 10,
              q: query,
              regionCode: 'IN',
            },
            timeout: 6000,
          },
        ),
      );

    const runWithKey = async (key: string): Promise<ResolvedYoutubeSong> => {
      // Pass 1 — "official" biased query to prefer actual videos
      const r1 = await makeRequest(
        key,
        `${trackName} ${artistName} official`,
      );
      const result1 = this.processYoutubeResponse(
        r1.data,
        normalizedTrackName,
        normalizedArtistName,
        false,
      );
      if (result1) return result1;

      // Pass 2 — broader query fallback
      this.logger.warn(
        `Pass 1 returned no usable results for "${trackName} - ${artistName}", trying Pass 2`,
      );
      const r2 = await makeRequest(key, `${trackName} ${artistName}`);
      const result2 = this.processYoutubeResponse(
        r2.data,
        normalizedTrackName,
        normalizedArtistName,
        true,
      );
      return result2!;
    };

    try {
      return await runWithKey(currentKey);
    } catch (error) {
      if (this.isQuotaError(error) && !this.useBackup) {
        this.logger.warn(
          'Primary YouTube Quota hit! Attempting fallback to BACKUP key.',
        );
        this.useBackup = true;
        this.lastQuotaReset = Date.now();
        const backupKey = process.env.YOUTUBE_API_KEY_BACKUP;
        if (backupKey) {
          return runWithKey(backupKey);
        }
      }
      throw error;
    }
  }

  // ─── Response Processing ──────────────────────────────────────────────────────

  private processYoutubeResponse(
    data: YoutubeSearchResponse,
    normalizedTrackName: string,
    normalizedArtistName: string,
    throwOnEmpty: boolean,
  ): ResolvedYoutubeSong | null {
    const rawItems = (data.items ?? []).filter(
      (item) => item.id?.videoId && item.snippet?.title,
    );

    // Filter out hard-rejected items
    const items = rawItems.filter(
      (item) => !this.scorer.isHardRejected(item.snippet!.title!),
    );

    const rejectedCount = rawItems.length - items.length;
    if (rejectedCount > 0) {
      this.logger.log(
        `Hard-rejected ${rejectedCount}/${rawItems.length} video(s) for "${normalizedTrackName}"`,
      );
    }

    if (items.length === 0) {
      if (throwOnEmpty) {
        throw new HttpException(
          'No playable YouTube match found for this song',
          HttpStatus.NOT_FOUND,
        );
      }
      return null;
    }

    // Score and pick the best
    const scored = items
      .map((item) => ({
        item,
        score: this.scorer.scoreVideo(item, normalizedArtistName, normalizedTrackName),
      }))
      .sort((a, b) => b.score - a.score);

    this.logger.debug(
      `YouTube candidates for "${normalizedTrackName}":\n` +
      scored
        .map(
          ({ item, score }) =>
            `  [${score}] "${item.snippet?.title}" — ${item.snippet?.channelTitle}`,
        )
        .join('\n'),
    );

    const best = scored[0].item;

    if (!best.id?.videoId || !best.snippet?.title) {
      if (throwOnEmpty) {
        throw new HttpException(
          'No playable YouTube match found for this song',
          HttpStatus.NOT_FOUND,
        );
      }
      return null;
    }

    return {
      youtubeId: best.id.videoId,
      youtubeTitle: best.snippet.title.trim(),
      normalizedTrackName,
      normalizedArtistName,
      image: this.pickThumbnail(best),
    };
  }

  private pickThumbnail(item: YoutubeSearchItem): string | null {
    const thumbnails = item.snippet?.thumbnails;
    return (
      thumbnails?.high?.url ??
      thumbnails?.medium?.url ??
      thumbnails?.default?.url ??
      null
    );
  }
}
