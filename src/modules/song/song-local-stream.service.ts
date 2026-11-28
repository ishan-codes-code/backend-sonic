import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { closeSync, constants, fstatSync, openSync } from 'fs';
import {
  assertMusicDirCurrent,
  closeValidatedMusicDir,
  getLocalSongPath,
  isValidYoutubeId,
  openValidatedMusicDir,
} from '../../infrastructure/storage/local-storage';

export interface PlaybackTokenPayload {
  sub: string;
  deviceId: string;
  scope: string;
}

export type ParsedRange =
  | { type: 'full' }
  | { type: 'range'; start: number; end: number }
  | { type: 'unsatisfiable' };

const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;

/**
 * Local-mode streaming primitives: playback-token verification, safe file
 * resolution/open, and single-range parsing. Stateless and side-effect free
 * apart from opening files; the controller owns HTTP framing.
 *
 * Tokens are never logged here or by callers.
 */
@Injectable()
export class SongLocalStreamService {
  private readonly jwtService = new JwtService({});

  constructor(private readonly configService: ConfigService) {}

  /**
   * Verify an Authorization header carrying a playback token. Checks the
   * signature against JWT_PLAYBACK_SECRET, expiry, and scope "stream".
   * Login (access) tokens are rejected: they fail the signature check when
   * secrets differ, and the scope check when they do not.
   */
  async verifyPlaybackToken(
    authorizationHeader: string | string[] | undefined,
  ): Promise<PlaybackTokenPayload> {
    const header = Array.isArray(authorizationHeader)
      ? authorizationHeader[0]
      : authorizationHeader;
    const match = header ? BEARER_PATTERN.exec(header.trim()) : null;
    if (!match) {
      throw new UnauthorizedException(
        'A playback token is required in the Authorization header.',
      );
    }

    const secret = this.configService.get<string>('JWT_PLAYBACK_SECRET');
    if (!secret) {
      throw new InternalServerErrorException(
        'Playback streaming is not configured.',
      );
    }

    let payload: unknown;
    try {
      payload = await this.jwtService.verifyAsync(match[1], { secret });
    } catch {
      throw new UnauthorizedException('Invalid or expired playback token.');
    }

    if (
      !payload ||
      typeof payload !== 'object' ||
      (payload as Record<string, unknown>).scope !== 'stream'
    ) {
      throw new UnauthorizedException('Invalid or expired playback token.');
    }
    return payload as PlaybackTokenPayload;
  }

  /** Resolve a youtubeId to its absolute local path. 400 when invalid. */
  resolveFilePath(youtubeId: string): string {
    if (!isValidYoutubeId(youtubeId)) {
      throw new BadRequestException('Invalid song id.');
    }
    const filePath = getLocalSongPath(youtubeId);
    if (!filePath) {
      throw new BadRequestException('Invalid song id.');
    }
    return filePath;
  }

  /**
   * Open the resolved file without following symlinks. The music folder
   * itself is validated first (never a followed symlink) and re-checked
   * after the open, so a swapped folder cannot redirect the read. Returns
   * the fd and size; the caller must close the fd. Missing files, symlinks,
   * non-files, and unsafe folders all become 404 so nothing outside ~/songs
   * is ever served.
   */
  openLocalFile(filePath: string): { fd: number; size: number } {
    let handle: ReturnType<typeof openValidatedMusicDir>;
    try {
      handle = openValidatedMusicDir();
    } catch {
      throw new NotFoundException('Song file not found.');
    }

    let fd: number;
    try {
      fd = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch {
      closeValidatedMusicDir(handle);
      throw new NotFoundException('Song file not found.');
    }
    try {
      const stats = fstatSync(fd);
      if (!stats.isFile()) {
        throw new NotFoundException('Song file not found.');
      }
      assertMusicDirCurrent(handle);
      return { fd, size: stats.size };
    } catch (error) {
      try {
        closeSync(fd);
      } catch {
        // Ignore close errors while propagating the original failure.
      }
      if (error instanceof NotFoundException) throw error;
      throw new NotFoundException('Song file not found.');
    } finally {
      closeValidatedMusicDir(handle);
    }
  }

  /**
   * Parse a Range header against the file size.
   * - absent/undecodable/multi-range/unknown-unit → full (200), per RFC 7233
   *   the server ignores range headers it cannot honor as one range;
   * - one satisfiable byte range → range (206);
   * - one syntactically valid but unsatisfiable range → unsatisfiable (416).
   */
  parseRange(
    rangeHeader: string | string[] | undefined,
    size: number,
  ): ParsedRange {
    const header = Array.isArray(rangeHeader) ? rangeHeader[0] : rangeHeader;
    if (!header) return { type: 'full' };

    const match = /^\s*bytes\s*=\s*(.+?)\s*$/.exec(header);
    if (!match) return { type: 'full' };

    const specs = match[1].split(',');
    if (specs.length !== 1) return { type: 'full' };

    const dash = specs[0].indexOf('-');
    if (dash === -1) return { type: 'full' };
    const startText = specs[0].slice(0, dash).trim();
    const endText = specs[0].slice(dash + 1).trim();

    if (startText === '' && endText === '') return { type: 'full' };

    if (startText === '') {
      const suffixLength = Number(endText);
      if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
        return { type: 'full' };
      }
      if (size === 0) return { type: 'unsatisfiable' };
      if (suffixLength >= size)
        return { type: 'range', start: 0, end: size - 1 };
      return { type: 'range', start: size - suffixLength, end: size - 1 };
    }

    const start = Number(startText);
    if (!Number.isInteger(start) || start < 0) return { type: 'full' };
    if (start >= size) return { type: 'unsatisfiable' };

    if (endText === '') return { type: 'range', start, end: size - 1 };

    const end = Number(endText);
    if (!Number.isInteger(end) || end < 0) return { type: 'full' };
    if (end < start) return { type: 'unsatisfiable' };
    return { type: 'range', start, end: Math.min(end, size - 1) };
  }
}
