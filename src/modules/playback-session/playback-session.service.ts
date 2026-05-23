import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

interface CacheEntry {
  token: string;
  expiresAt: number;
}

/**
 * How far before a token's real expiry we consider it "too stale" to hand out.
 * 30 min covers a full album listen without risking a mid-playback expiry.
 * Tune this if JWT_PLAYBACK_EXPIRES_IN is shorter than ~60 min.
 */
const SAFETY_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

@Injectable()
export class PlaybackSessionService {
  private readonly logger = new Logger(PlaybackSessionService.name);

  // Fast in-memory cache: userId:deviceId → { token, expiresAt }
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly jwtService: JwtService) {}

  async getOrCreatePlaybackToken(userId: string, deviceId: string): Promise<string> {
    const key = `${userId}:${deviceId}`;
    const now = Date.now();

    // Return cached token only if it still has at least SAFETY_WINDOW_MS left,
    // so callers always receive a token that won't expire mid-stream.
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt - now > SAFETY_WINDOW_MS) {
      return cached.token;
    }

    // Generate a fresh token
    const payload = { sub: userId, deviceId, scope: 'stream' };
    const token = await this.jwtService.signAsync(payload);

    // Decode to get the real exp timestamp set by JwtService
    const decoded = this.jwtService.decode(token) as { exp?: number } | null;
    const expiresAt = decoded?.exp
      ? decoded.exp * 1000
      : now + 24 * 60 * 60 * 1000; // fallback: 24 h

    this.cache.set(key, { token, expiresAt });

    // Lazy GC: prune truly expired entries when the map gets large
    if (this.cache.size > 10_000) {
      this.cleanExpiredTokens();
    }

    return token;
  }

  private cleanExpiredTokens(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      // Only remove entries whose token has actually expired, not just inside the safety window.
      // Those will be refreshed naturally on next request.
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
  }
}
