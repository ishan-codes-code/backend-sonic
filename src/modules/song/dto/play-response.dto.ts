import { InferSelectModel } from 'drizzle-orm';
import { songs, artists } from '../../../infrastructure/database/schema';

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

export function toSongDto(song: Song): SongDto {
  const workerStreamUrl = process.env.WORKER_STREAM_URL || 'http://127.0.0.1:8787';
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
    streamUrl: `${workerStreamUrl}/stream/${song.youtubeId}`,
  };
}

// ── Play response union ───────────────────────────────────────────────────────

/**
 * `ready`  — song is in R2. `songId` is the stable ID the client should use
 *            to stream via  GET /song/:id  (which presigns & redirects).
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
