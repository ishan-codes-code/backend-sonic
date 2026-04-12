import { InferSelectModel } from 'drizzle-orm';
import { songs } from '../../../infrastructure/database/schema';

export type Song = InferSelectModel<typeof songs>;

export type PlayResponseDto =
  | { type: 'ready'; streamUrl: string; song: Song }
  | { type: 'job'; jobId: string };

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
      image?: string;
      lastfmId?: string;
    };
  };