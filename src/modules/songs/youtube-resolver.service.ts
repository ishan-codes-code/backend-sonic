import axios from 'axios';
import {
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { HttpException } from '@nestjs/common';
import { lastValueFrom } from 'rxjs';
import { normalizeString } from '../../shared/utils/string.utils';

interface YoutubeSearchItem {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    thumbnails?: {
      high?: { url?: string };
      medium?: { url?: string };
      default?: { url?: string };
    };
  };
}

interface YoutubeSearchResponse {
  items?: YoutubeSearchItem[];
}

export interface ResolvedYoutubeSong {
  youtubeId: string;
  youtubeTitle: string;
  normalizedTrackName: string;
  normalizedArtistName: string;
  image: string | null;
  duration?: number;
}

@Injectable()
export class YoutubeResolverService {
  private readonly logger = new Logger(YoutubeResolverService.name);

  // 🛡️ Deduplication: Store in-flight promises to prevent multiple calls for same song
  private resolvingRequests = new Map<string, Promise<ResolvedYoutubeSong>>();

  // 🔒 Quota state: if true, we stick to the backup key
  private useBackup = false;
  private lastQuotaReset = Date.now();

  constructor(private readonly httpService: HttpService) { }

  private scoreVideo(item: YoutubeSearchItem, normalizedArtist: string): number {
    const title = item.snippet?.title?.toLowerCase() ?? '';
    const channel = item.snippet?.channelTitle?.toLowerCase() ?? '';

    let score = 0;

    const isTopic = channel.includes('topic');

    // 🎯 STRONG SIGNALS
    if (isTopic) score += 20;

    if (title.includes('official audio')) {
      score += 12;
    } else if (title.includes('audio')) {
      score += 2;
    }

    // 🎬 Official video
    if (title.includes('official music video')) score += 8;
    else if (title.includes('official video')) score += 6;

    // 🎤 Matching
    if (title.includes(normalizedArtist)) score += 6;
    if (channel.includes(normalizedArtist)) score += 6;

    // 📺 Trusted channels
    if (channel.includes('vevo')) score += 5;

    // ❌ NEGATIVE SIGNALS
    if (title.includes('remix')) score -= 6;
    if (title.includes('live')) score -= 5;
    if (title.includes('cover')) score -= 6;
    if (title.includes('lyrics')) score -= 6;
    if (title.includes('karaoke')) score -= 8;

    return score;
  }

  private getApiKey(): string {
    const isDev = process.env.NODE_ENV === 'development';

    if (isDev && process.env.YOUTUBE_API_KEY_DEV) {
      return process.env.YOUTUBE_API_KEY_DEV;
    }

    // 🕒 Auto-reset logic: Check if 24 hours passed since we switched to backup
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
      process.env.YOUTUBE_API_KEY_PROD ||
      process.env.YOUTUBE_API_KEY ||
      ''
    );
  }

  private isQuotaError(error: any): boolean {
    const reason = error?.response?.data?.error?.errors?.[0]?.reason;
    return reason === 'quotaExceeded' || reason === 'dailyLimitExceeded';
  }

  /**
   * 📉 Check if all production keys are likely exhausted
   */
  public isQuotaExhausted(): boolean {
    if (!this.useBackup) return false;

    // If we are on backup, check if the 24h cooldown is still active
    const twentyFourHours = 24 * 60 * 60 * 1000;
    return Date.now() - this.lastQuotaReset < twentyFourHours;
  }

  async resolveFromTrackAndArtist(
    trackName: string,
    artistName: string,
  ): Promise<ResolvedYoutubeSong> {
    const cacheKey = `${trackName}:${artistName}`.toLowerCase().trim();

    // ── STEP 1: Deduplication ──────────────────────────────────────────
    // If we are already resolving this exact song right now, wait for that promise
    if (this.resolvingRequests.has(cacheKey)) {
      this.logger.log(`Deduplicating in-flight request for: ${cacheKey}`);
      return this.resolvingRequests.get(cacheKey)!;
    }

    const resolutionPromise = (async () => {
      try {
        return await this.performResolution(trackName, artistName);
      } finally {
        // Clean up map once done
        this.resolvingRequests.delete(cacheKey);
      }
    })();

    this.resolvingRequests.set(cacheKey, resolutionPromise);
    return resolutionPromise;
  }

  private async performResolution(
    trackName: string,
    artistName: string,
  ): Promise<ResolvedYoutubeSong> {
    const normalizedTrackName = normalizeString(trackName);
    const normalizedArtistName = normalizeString(artistName);
    const query = `${trackName} ${artistName}`;

    try {
      return await this.fetchWithRetry(query, normalizedTrackName, normalizedArtistName);
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
    query: string,
    normalizedTrackName: string,
    normalizedArtistName: string,
  ): Promise<ResolvedYoutubeSong> {
    let currentKey = this.getApiKey();

    const fetchTask = async (key: string) => {
      return await lastValueFrom(
        this.httpService.get<YoutubeSearchResponse>(
          'https://www.googleapis.com/youtube/v3/search',
          {
            params: {
              key,
              part: 'snippet',
              type: 'video',
              maxResults: 5,
              videoCategoryId: 10,
              q: `${query} official audio`,
            },
            timeout: 5000,
          },
        ),
      );
    };

    try {
      const response = await fetchTask(currentKey);
      return this.processYoutubeResponse(response.data, normalizedTrackName, normalizedArtistName);
    } catch (error) {
      // 🔄 Fallback Logic
      if (this.isQuotaError(error) && !this.useBackup) {
        this.logger.warn('Primary YouTube Quota hit! Attempting fallback to BACKUP key.');
        this.useBackup = true;
        this.lastQuotaReset = Date.now(); // Track when we switched
        const backupKey = process.env.YOUTUBE_API_KEY_BACKUP;

        if (backupKey) {
          const response = await fetchTask(backupKey);
          return this.processYoutubeResponse(response.data, normalizedTrackName, normalizedArtistName);
        }
      }

      throw error;
    }
  }

  private async processYoutubeResponse(
    data: YoutubeSearchResponse,
    normalizedTrackName: string,
    normalizedArtistName: string,
  ): Promise<ResolvedYoutubeSong> {
    const items = (data.items ?? []).filter(
      (item) => item.id?.videoId && item.snippet?.title,
    );

    if (items.length === 0) {
      throw new HttpException(
        'No playable YouTube match found for this song',
        HttpStatus.NOT_FOUND,
      );
    }

    const bestMatch = items
      .map((item) => ({
        item,
        score: this.scoreVideo(item, normalizedArtistName),
      }))
      .sort((a, b) => b.score - a.score)[0]?.item;

    if (!bestMatch?.id?.videoId || !bestMatch.snippet?.title) {
      throw new HttpException(
        'No playable YouTube match found for this song',
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      youtubeId: bestMatch.id.videoId,
      youtubeTitle: bestMatch.snippet.title.trim(),
      normalizedTrackName,
      normalizedArtistName,
      image: await getYoutubeThumbnail(
        bestMatch.id.videoId,
        bestMatch.snippet.thumbnails?.high?.url ??
        bestMatch.snippet.thumbnails?.medium?.url ??
        bestMatch.snippet.thumbnails?.default?.url ??
        null,
      ),
    };
  }
}

export async function getYoutubeThumbnail(
  videoId: string,
  fallback: string | null,
): Promise<string | null> {
  const maxresUrl = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;

  try {
    const res = await axios.head(maxresUrl, { timeout: 5000 });

    if (res.status === 200) {
      return maxresUrl;
    }
  } catch (err) {
    // maxres not available
  }

  return fallback;
}
