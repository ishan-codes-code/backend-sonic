import { InferSelectModel } from 'drizzle-orm';
import { songs, artists } from '../../../infrastructure/database/schema';
import { loadRuntimeConfig } from '../../../infrastructure/config/runtime-config';
import { getStorageMode } from '../../../infrastructure/config/setup-requirements';

export type Artist = InferSelectModel<typeof artists>;
export type Song = InferSelectModel<typeof songs> & { artists?: Artist[] };

// ── Clean client-facing DTOs ─────────────────────────────────────────────────

export interface ArtistDto {
  id: string;
  name: string;
}

export interface SongDto {
  id: string;
  trackName: string;
  albumName: string | null;
  duration: number;
  image: string | null;
  externalId: string | null;
  lastfmId: string | null;
  youtubeId: string;
  artists: ArtistDto[];
  createdAt: Date;
  streamUrl: string;
}

/**
 * Build the client-facing song DTO.
 *
 * In r2 mode the stream URL points at the configured worker stream base. In
 * local mode it points at `<apiBaseUrl>/stream/<youtubeId>`, where the API
 * base is derived per request from the request the phone used (see
 * stream-base.ts) and must be supplied by the caller. Local stream URLs are
 * never cached across requests.
 */
export function toSongDto(song: Song, apiBaseUrl?: string): SongDto {
  const config = loadRuntimeConfig();
  const mode = getStorageMode(config) ?? 'r2';
  let streamUrl: string;
  if (mode === 'local') {
    if (!apiBaseUrl) {
      throw new Error(
        'Local storage mode requires the request API base URL to build streamUrl.',
      );
    }
    streamUrl = `${apiBaseUrl.replace(/\/+$/, '')}/stream/${song.youtubeId}`;
  } else {
    const workerStreamUrl =
      config.WORKER_STREAM_URL || 'http://127.0.0.1:8787';
    streamUrl = `${workerStreamUrl}/stream/${song.youtubeId}`;
  }
  return {
    id: song.id,
    trackName: song.trackName,
    albumName: song.albumName ?? null,
    duration: song.duration,
    image: song.image ?? null,
    externalId: song.externalId ?? null,
    lastfmId: song.lastfmId ?? null,
    youtubeId: song.youtubeId,
    artists: (song.artists ?? []).map((a) => ({ id: a.id, name: a.name })),
    createdAt: song.createdAt,
    streamUrl,
  };
}

// ── Play response union ───────────────────────────────────────────────────────

/**
 * `ready`  — song content is available (R2 object or local file). The client
 *            streams `song.streamUrl` with the `playbackToken` bearer token.
 * `job`    — song is being processed. Poll GET /song/job/:jobId for status.
 */
export type PlayResponseDto =
  | { type: 'ready'; song: SongDto; playbackToken?: string; }
  | { type: 'job'; jobId: string; playbackToken?: string; };

// ── Internal resolver union (not sent to client) ──────────────────────────────

export type ResolvedPlayableSong =
  | { type: 'songId'; songId: string }
  | { type: 'existing'; song: Song }
  | {
    type: 'resolved';
    data: {
      youtubeId: string;
      songId?: string;
      trackName: string;
      artistName: string;
      normalizedTrackName: string;
      normalizedArtistName: string;
      youtubeTitle: string;
      duration?: number;
      image?: string | null;
      externalId?: string;
      lastfmId?: string;
    };
  };
