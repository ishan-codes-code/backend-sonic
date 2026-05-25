import { Injectable, Logger } from '@nestjs/common';
import {
  LastFmService,
  LastFmTrackMetadata,
} from '../../services/lastfm.service';
import { normalizeString } from '../../shared/utils/string.utils';
import { ListeningService } from '../listening/listening.service';

interface RecommendationCacheEntry {
  expiresAt: number;
  results: RecommendationTrack[];
}

interface RecentSeed {
  trackName: string;
  artistName: string;
  apiArtistName: string;
  normalizedTrackName: string;
  normalizedArtistName: string;
  recencyRank: number;
  listeningSignalWeight: number;
}

interface ScoredCandidate {
  track: RecommendationTrack;
  score: number;
}

export interface RecommendationTrack {
  trackName: string;
  artistName: string;
  image: string | null;
  duration: number | null;
  lastfmId: string | null;
  score: number;
}

@Injectable()
export class RecommendationService {
  private readonly logger = new Logger(RecommendationService.name);
  private readonly cache = new Map<string, RecommendationCacheEntry>();
  private readonly cacheTtlMs = 10 * 60 * 1000;
  private readonly maxLimit = 50;
  private readonly recentSeedLimit = 8;
  private readonly recentHistoryScanLimit = 40;
  private readonly perSeedFetchLimit = 15;

  constructor(
    private readonly lastFmService: LastFmService,
    private readonly listeningService: ListeningService,
  ) {}

  async getRecommendationsForUser(
    userId: string,
    limit: number,
  ): Promise<RecommendationTrack[]> {
    const safeLimit = this.normalizeLimit(limit);
    const seeds = await this.getRecentSeeds(userId);

    if (seeds.length === 0) {
      return [];
    }

    const cacheKey = this.buildCacheKey(userId, seeds);
    const now = Date.now();
    const cached = this.cache.get(cacheKey);

    if (cached && cached.expiresAt > now) {
      return cached.results.slice(0, safeLimit);
    }

    if (cached) this.cache.delete(cacheKey);

    const seedResults = await Promise.all(
      seeds.map(async (seed) => {
        try {
          const tracks = await this.lastFmService.getSimilarTracks(
            seed.trackName,
            seed.apiArtistName,
            this.perSeedFetchLimit,
          );

          return { seed, tracks };
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Similar-track fetch failed for "${seed.trackName}" by "${seed.artistName}": ${msg}`,
          );
          return { seed, tracks: [] };
        }
      }),
    );

    const recentKeys = new Set(
      seeds.map((seed) =>
        this.getTrackKey(seed.normalizedTrackName, seed.normalizedArtistName),
      ),
    );

    const queue = this.buildQueue(seedResults, recentKeys);
    this.cache.set(cacheKey, {
      expiresAt: now + this.cacheTtlMs,
      results: queue,
    });

    return queue.slice(0, safeLimit);
  }

  private async getRecentSeeds(userId: string): Promise<RecentSeed[]> {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const tasteSignals = await this.listeningService.getRecentTasteSignals(
      userId,
      twoHoursAgo,
      5,
    );

    const history = await this.listeningService.getUserHistory(
      userId,
      this.recentHistoryScanLimit,
      0,
    );

    const seeds: RecentSeed[] = [];
    const seen = new Set<string>();

    for (const signal of tasteSignals) {
      const seed = this.toRecentSeed(signal, seeds.length, 3); // 3x multiplier
      if (!seed) continue;

      const key = this.getTrackKey(
        seed.normalizedTrackName,
        seed.normalizedArtistName,
      );
      if (seen.has(key)) continue;

      seen.add(key);
      seeds.push(seed);
    }

    for (const event of history) {
      const seed = this.toRecentSeed(event, seeds.length, 1); // 1x multiplier
      if (!seed) continue;

      const key = this.getTrackKey(
        seed.normalizedTrackName,
        seed.normalizedArtistName,
      );
      if (seen.has(key)) continue;

      seen.add(key);
      seeds.push(seed);

      if (seeds.length >= this.recentSeedLimit) break;
    }

    return seeds;
  }

  private toRecentSeed(event: any, recencyRank: number, multiplier: number = 1): RecentSeed | null {
    const song = event.song as {
      trackName?: string;
      duration?: number;
      artists?: Array<{ name?: string }>;
    } | null;
    const allArtists = song?.artists || [];
    const primaryArtist = allArtists[0];
    if (!song?.trackName || !primaryArtist?.name) return null;

    const artistName = allArtists.map((a) => a.name).join(', ');
    const normalizedTrackName = normalizeString(song.trackName);
    const normalizedArtistName = normalizeString(artistName);
    if (!normalizedTrackName || !normalizedArtistName) return null;

    return {
      trackName: song.trackName,
      artistName: artistName,
      apiArtistName: primaryArtist.name,
      normalizedTrackName,
      normalizedArtistName,
      recencyRank,
      listeningSignalWeight: this.getListeningSignalWeight(event, song) * multiplier,
    };
  }

  private getListeningSignalWeight(
    event: {
      completed?: boolean | null;
      durationListenedSeconds?: number | null;
    },
    song: { duration?: number | null } | null,
  ): number {
    let weight = 1;

    if (event.completed) {
      weight += 0.2;
    }

    const listenedSeconds = event.durationListenedSeconds ?? 0;
    const songDurationSeconds = song?.duration ?? 0;
    if (listenedSeconds > 0 && songDurationSeconds > 0) {
      const listenRatio = Math.min(listenedSeconds / songDurationSeconds, 1);

      if (listenRatio >= 0.8) {
        weight += 0.2;
      } else if (listenRatio >= 0.5) {
        weight += 0.1;
      } else if (listenRatio < 0.2) {
        weight -= 0.2;
      }
    }

    return Number(Math.max(0.5, Math.min(weight, 1.4)).toFixed(2));
  }

  private buildQueue(
    seedResults: Array<{ seed: RecentSeed; tracks: LastFmTrackMetadata[] }>,
    recentKeys: Set<string>,
  ): RecommendationTrack[] {
    const candidates = new Map<string, ScoredCandidate>();

    for (const { seed, tracks } of seedResults) {
      tracks.forEach((track, rank) => {
        const normalizedTrackName = normalizeString(track.title);
        const normalizedArtistName = normalizeString(track.artist);
        if (!normalizedTrackName || !normalizedArtistName) return;

        const key = this.getTrackKey(normalizedTrackName, normalizedArtistName);
        if (recentKeys.has(key)) return;

        const score = this.scoreCandidate(
          seed.recencyRank,
          rank,
          seed.listeningSignalWeight,
        );
        const existing = candidates.get(key);

        if (existing) {
          existing.score += score * 0.35;
          existing.track.score = Number(existing.score.toFixed(4));
          return;
        }

        candidates.set(key, {
          score,
          track: {
            trackName: track.title.trim(),
            artistName: track.artist.trim(),
            image: track.image ?? null,
            duration: track.duration ?? null,
            lastfmId: track.lastfmId ?? null,
            score: Number(score.toFixed(4)),
          },
        });
      });
    }

    return [...candidates.values()]
      .sort((a, b) => b.score - a.score)
      .map((candidate) => ({
        ...candidate.track,
        score: Number(candidate.score.toFixed(4)),
      }));
  }

  private scoreCandidate(
    seedRank: number,
    resultRank: number,
    listeningSignalWeight: number,
  ): number {
    const seedWeight = 1 / (seedRank + 1);
    const resultWeight = 1 / Math.sqrt(resultRank + 1);
    return seedWeight * resultWeight * listeningSignalWeight;
  }

  private buildCacheKey(userId: string, seeds: RecentSeed[]): string {
    const seedSignature = seeds
      .map((seed) =>
        [
          seed.normalizedTrackName,
          seed.normalizedArtistName,
          seed.recencyRank,
          seed.listeningSignalWeight,
        ].join(':'),
      )
      .join('|');

    return `${userId}:${seedSignature}`;
  }

  private getTrackKey(trackName: string, artistName: string): string {
    return `${trackName}:${artistName}`;
  }

  private normalizeLimit(limit: number): number {
    if (!Number.isFinite(limit)) return 20;
    return Math.max(1, Math.min(this.maxLimit, Math.floor(limit)));
  }
}
