import { HttpException, HttpStatus, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { R2Service } from '../../infrastructure/r2/r2.service';
import { SongCatalogService } from './song-catalog.service';
import { Song } from './dto/play-response.dto';

// R2 presigned URLs expire in 300s. Cache for 240s to stay safely under the limit.
const STREAM_URL_TTL_MS = 240_000;

// Prune stale entries every 5 minutes to prevent unbounded memory growth.
const CACHE_PRUNE_INTERVAL_MS = 5 * 60_000;

interface CacheEntry {
  url: string;
  expiresAt: number;
}

@Injectable()
export class SongStreamService implements OnModuleDestroy {
  private readonly logger = new Logger(SongStreamService.name);
  private readonly urlCache = new Map<string, CacheEntry>();
  private readonly pruneTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly songCatalogService: SongCatalogService,
    private readonly r2Service: R2Service,
  ) {
    this.pruneTimer = setInterval(() => this.pruneExpiredEntries(), CACHE_PRUNE_INTERVAL_MS);
  }

  onModuleDestroy() {
    clearInterval(this.pruneTimer);
  }

  async getStreamUrlBySongId(
    songId: string,
  ): Promise<{ type: 'ready'; streamUrl: string; song: Song }> {
    const song = await this.songCatalogService.findById(songId);

    if (!song) {
      throw new HttpException('Song not found', HttpStatus.NOT_FOUND);
    }

    const streamUrl = await this.getCachedOrFreshUrl(songId, song.r2Key);

    return { type: 'ready', streamUrl, song };
  }

  async getStreamUrlForSong(song: Song): Promise<string> {
    return this.getCachedOrFreshUrl(song.id, song.r2Key);
  }

  async tryGetStreamUrl(r2Key: string): Promise<string | null> {
    try {
      return await this.r2Service.getSignedUrl(r2Key);
    } catch {
      return null;
    }
  }

  // ─── Internal helpers ───────────────────────────────────────────────────

  async getCachedOrFreshUrl(songId: string, r2Key: string): Promise<string> {
    const cached = this.urlCache.get(songId);

    if (cached && Date.now() < cached.expiresAt) {
      this.logger.debug(`Cache HIT for songId=${songId}`);
      return cached.url;
    }

    this.logger.debug(`Cache MISS for songId=${songId} — fetching fresh signed URL`);
    const url = await this.r2Service.getSignedUrl(r2Key);

    this.urlCache.set(songId, { url, expiresAt: Date.now() + STREAM_URL_TTL_MS });
    return url;
  }

  private pruneExpiredEntries(): void {
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of this.urlCache) {
      if (now >= entry.expiresAt) {
        this.urlCache.delete(key);
        pruned++;
      }
    }
    if (pruned > 0) {
      this.logger.debug(`Pruned ${pruned} expired stream URL cache entries`);
    }
  }
}
