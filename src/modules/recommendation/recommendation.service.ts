import { Injectable, Logger } from '@nestjs/common';
import {
  LastFmService,
  LastFmTrackMetadata,
} from '../../services/lastfm.service';
import { normalizeString } from '../../shared/utils/string.utils';
import { SongCatalogService } from '../songs/song-catalog.service';
import { YoutubeResolverService } from '../songs/youtube-resolver.service';

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

  constructor(
    private readonly lastFmService: LastFmService,
    private readonly youtubeResolverService: YoutubeResolverService,
    private readonly songCatalogService: SongCatalogService,
  ) { }

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
      const isQuotaExhausted = this.youtubeResolverService.isQuotaExhausted();

      // const isQuotaExhausted = true;

      // 🕒 Only over-fetch (50) if we are in "Library-Only" mode to find matches.
      // Otherwise, keep it standard to save Last.fm resources.
      const fetchLimit = isQuotaExhausted ? 50 : Math.max(10, safeLimit);

      const rawTracks = await this.lastFmService.getSimilarTracks(
        title,
        artist,
        fetchLimit,
      );

      let results = this.sanitize(rawTracks, fetchLimit);

      if (isQuotaExhausted) {
        this.logger.warn('YouTube Quota exhausted. Filtering recommendations to Library ONLY.');
        // 🕵️ Check which ones we already have in our library (Only needed if exhausted)
        const tracksWithLibStatus = await Promise.all(
          results.map(async (t) => {
            const normTitle = normalizeString(t.trackName);
            const normArtist = normalizeString(t.artistName);
            const existing = await this.songCatalogService.findByNormalizedTrackArtist(normTitle, normArtist);
            return { track: t, inLibrary: !!existing };
          }),
        );

        // 🔒 Fallback: ONLY return what we already have in DB
        results = tracksWithLibStatus
          .filter((t) => t.inLibrary)
          .map((t) => t.track);
      }
      // If NOT exhausted, we leave 'results' in its natural Last.fm order.

      this.cache.set(cacheKey, { expiresAt: now + this.cacheTtlMs, results });

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
