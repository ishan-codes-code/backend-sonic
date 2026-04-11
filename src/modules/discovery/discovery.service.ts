import { Injectable, Logger } from '@nestjs/common';
import {
  LastFmService,
  LastFmTrackMetadata,
} from '../../services/lastfm.service';
import { normalizeString } from '../../shared/utils/string.utils';

interface DiscoveryCacheEntry {
  expiresAt: number;
  results: DiscoveryTrack[];
}

export interface DiscoveryTrack {
  trackName: string;
  artistName: string;
  image: string | null;
  duration: number | null;
}

@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);
  private readonly cache = new Map<string, DiscoveryCacheEntry>();
  private readonly cacheTtlMs = 30 * 60 * 1000; // 30 minutes for discovery

  constructor(private readonly lastFmService: LastFmService) { }

  async getTracksByGenre(
    genre: string,
    limit: number,
  ): Promise<DiscoveryTrack[]> {
    const safeLimit = this.normalizeLimit(limit);
    const cacheKey = `genre_${normalizeString(genre)}`;
    const now = Date.now();

    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.results.slice(0, safeLimit);
    }

    if (cached) this.cache.delete(cacheKey);

    try {
      // Fetch a bit more to allow for sanitization/deduplication
      const fetchLimit = Math.max(50, safeLimit);
      const rawTracks = await this.lastFmService.getTopTracksByTag(
        genre,
        fetchLimit,
      );

      const results = this.sanitize(rawTracks, fetchLimit);

      this.cache.set(cacheKey, { expiresAt: now + this.cacheTtlMs, results });

      return results.slice(0, safeLimit);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Discovery failed for genre "${genre}": ${msg}`);
      return [];
    }
  }

  private normalizeLimit(limit: number): number {
    if (!Number.isFinite(limit)) return 20;
    return Math.max(1, Math.min(100, Math.floor(limit)));
  }

  private sanitize(
    tracks: LastFmTrackMetadata[],
    limit: number,
  ): DiscoveryTrack[] {
    const deduped: DiscoveryTrack[] = [];
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
