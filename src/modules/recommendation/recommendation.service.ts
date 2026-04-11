import { Injectable, Logger } from '@nestjs/common';
import {
  LastFmService,
  LastFmTrackMetadata,
} from '../../services/lastfm.service';
import { normalizeString } from '../../shared/utils/string.utils';

interface RecommendationCacheEntry {
  expiresAt: number;
  results: RecommendationTrack[];
}

export interface RecommendationTrack {
  trackName: string;
  artistName: string;
  image: string | null;
  duration: number | null;
}

@Injectable()
export class RecommendationService {
  private readonly logger = new Logger(RecommendationService.name);
  private readonly cache = new Map<string, RecommendationCacheEntry>();
  private readonly cacheTtlMs = 15 * 60 * 1000;

  constructor(private readonly lastFmService: LastFmService) { }

  async getRecommendations(
    title: string,
    artist: string,
    limit: number,
  ): Promise<RecommendationTrack[]> {
    const safeLimit = this.normalizeLimit(limit);
    const cacheKey = `${normalizeString(title)}_${normalizeString(artist)}`;
    const now = Date.now();

    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.results.slice(0, safeLimit);
    }

    if (cached) this.cache.delete(cacheKey);

    try {
      const fetchLimit = Math.max(20, safeLimit);
      const rawTracks = await this.lastFmService.getSimilarTracks(
        title,
        artist,
        fetchLimit,
      );

      const results = this.sanitize(rawTracks, fetchLimit);

      this.cache.set(cacheKey, { expiresAt: now + this.cacheTtlMs, results });

      console.log(JSON.stringify(results, null, 2));

      return results.slice(0, safeLimit);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Recommendations failed for "${title}" by "${artist}": ${msg}`);
      return [];
    }
  }

  private normalizeLimit(limit: number): number {
    if (!Number.isFinite(limit)) return 20;
    return Math.max(1, Math.floor(limit));
  }

  private sanitize(
    tracks: LastFmTrackMetadata[],
    limit: number,
  ): RecommendationTrack[] {
    const deduped: RecommendationTrack[] = [];
    const seen = new Set<string>();

    for (const track of tracks) {
      const normTrack = normalizeString(track.title);
      const normArtist = normalizeString(track.artist);

      if (!normTrack || !normArtist) continue;

      const key = `${normTrack}_${normArtist}`;
      if (seen.has(key)) continue;

      seen.add(key);
      deduped.push({
        trackName: track.title.trim(),
        artistName: track.artist.trim(),
        image: track.image ?? null,
        duration: track.duration ?? null,
      });

      if (deduped.length >= limit) break;
    }

    return deduped;
  }
}
