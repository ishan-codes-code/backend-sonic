import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { normalizeString } from '../shared/utils/string.utils';

const LASTFM_PLACEHOLDER_IMAGE_HASH = '2a96cbd8b46e442fc41c2b86b821562f';

interface LastFmTrack {
  name: string;
  artist: string;
  url: string;
  streamable: string;
  listeners: string;
  image: { '#text': string; size: string }[];
  mbid: string;
}

interface LastFmTrackSearchResponse {
  results?: {
    trackmatches?: {
      track?: LastFmTrack[] | LastFmTrack;
    };
  };
}

interface LastFmTagTracksResponse {
  tracks?: {
    track?: LastFmTagTrack[] | LastFmTagTrack;
  };
}

interface LastFmTagTrack {
  name: string;
  artist: { name: string };
  image: { '#text': string; size: string }[];
  duration?: string;
}

interface LastFmTrackSimilarResponse {
  similartracks?: {
    track?: LastFmSimilarTrack[] | LastFmSimilarTrack;
  };
}

interface LastFmTrackArtist {
  name?: string;
}

interface LastFmSimilarTrack {
  name?: string;
  artist?: string | LastFmTrackArtist;
  image?: { '#text': string; size: string }[];
  duration?: number;
}

export interface SearchTrackResult {
  id: string;
  title: string;
  artist: string;
  image: string | null;
}

export interface LastFmTrackMetadata {
  title: string;
  artist: string;
  image: string | null;
  duration?: number | null;
}

export function pickLastFmBestArtworkUrl(
  images: Array<{ '#text'?: unknown; size?: unknown }> | null | undefined,
): string | null {
  if (!images || !Array.isArray(images) || images.length === 0) return null;

  for (let idx = images.length - 1; idx >= 0; idx -= 1) {
    const rawUrl = images[idx]?.['#text'];
    if (typeof rawUrl !== 'string') continue;

    const url = rawUrl.trim();
    if (!url) continue;
    if (url.includes(LASTFM_PLACEHOLDER_IMAGE_HASH)) continue;

    return url;
  }

  return null;
}

function extractArtistName(
  artist: string | LastFmTrackArtist | undefined,
): string {
  if (typeof artist === 'string') {
    return artist;
  }

  if (artist && typeof artist.name === 'string') {
    return artist.name;
  }

  return '';
}

@Injectable()
export class LastFmService {
  private readonly logger = new Logger(LastFmService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) { }

  /** @deprecated Use shared normalizeString from shared/utils/string.utils instead */
  normalizeString(str: string): string {
    return normalizeString(str);
  }

  async getSimilarTracks(
    title: string,
    artist: string,
    limit: number,
  ): Promise<LastFmTrackMetadata[]> {
    const apiKey = this.configService.get<string>('lastfm.apiKey');
    if (!apiKey) {
      throw new InternalServerErrorException(
        'LASTFM_API_KEY is not configured',
      );
    }

    const safeLimit = Math.max(1, Math.floor(limit));

    const response = await lastValueFrom(
      this.httpService.get<LastFmTrackSimilarResponse>(
        'https://ws.audioscrobbler.com/2.0/',
        {
          params: {
            method: 'track.getSimilar',
            track: title,
            artist,
            api_key: apiKey,
            format: 'json',
            limit: safeLimit,
          },
          timeout: 5000,
        },
      ),
    );


    const trackData = response.data?.similartracks?.track;
    const tracks: LastFmSimilarTrack[] = Array.isArray(trackData)
      ? trackData
      : trackData
        ? [trackData]
        : [];

    return tracks.map((track) => ({
      title: typeof track.name === 'string' ? track.name : '',
      artist: extractArtistName(track.artist),
      image: pickLastFmBestArtworkUrl(track.image),
      duration: typeof track.duration === 'number' ? track.duration : null,
    }));
  }

  async searchLastFmTracks(query: string): Promise<SearchTrackResult[]> {
    const apiKey = this.configService.get<string>('lastfm.apiKey');
    if (!apiKey) {
      throw new InternalServerErrorException(
        'LASTFM_API_KEY is not configured',
      );
    }

    try {
      const response = await lastValueFrom(
        this.httpService.get<LastFmTrackSearchResponse>(
          'https://ws.audioscrobbler.com/2.0/',
          {
            params: {
              method: 'track.search',
              track: query,
              api_key: apiKey,
              format: 'json',
              limit: 20,
            },
            timeout: 5000,
          },
        ),
      );

      const trackData = response.data?.results?.trackmatches?.track;
      const tracks: LastFmTrack[] = Array.isArray(trackData)
        ? trackData
        : trackData
          ? [trackData]
          : [];
      const uniqueResults: SearchTrackResult[] = [];
      const seen = new Set<string>();

      for (const track of tracks) {
        const normalizedTitle = this.normalizeString(track.name);
        const normalizedArtist = this.normalizeString(track.artist);

        if (!normalizedTitle || !normalizedArtist) continue;

        const uniqueId = `${normalizedTitle}-${normalizedArtist}`;

        if (!seen.has(uniqueId)) {
          seen.add(uniqueId);
          uniqueResults.push({
            id: uniqueId,
            title: track.name,
            artist: track.artist,
            image: pickLastFmBestArtworkUrl(track.image),
          });
        }
      }

      return uniqueResults;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Last.fm API error: ${message}`);
      throw new InternalServerErrorException(
        'Failed to search tracks from Last.fm',
      );
    }
  }

  async getTopTracksByTag(
    tag: string,
    limit: number,
  ): Promise<LastFmTrackMetadata[]> {
    const apiKey = this.configService.get<string>('lastfm.apiKey');
    if (!apiKey) {
      throw new InternalServerErrorException(
        'LASTFM_API_KEY is not configured',
      );
    }

    const safeLimit = Math.max(1, Math.floor(limit));

    try {
      const response = await lastValueFrom(
        this.httpService.get<LastFmTagTracksResponse>(
          'https://ws.audioscrobbler.com/2.0/',
          {
            params: {
              method: 'tag.getTopTracks',
              tag,
              api_key: apiKey,
              format: 'json',
              limit: safeLimit,
            },
            timeout: 5000,
          },
        ),
      );

      const trackData = response.data?.tracks?.track;
      const tracks: LastFmTagTrack[] = Array.isArray(trackData)
        ? trackData
        : trackData
          ? [trackData]
          : [];

      return tracks.map((track) => ({
        title: typeof track.name === 'string' ? track.name : '',
        artist: extractArtistName(track.artist),
        image: pickLastFmBestArtworkUrl(track.image),
        duration: track.duration ? parseInt(track.duration, 10) : null,
      }));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Last.fm API error (tag.getTopTracks): ${message}`);
      throw new InternalServerErrorException(
        `Failed to fetch tracks for tag "${tag}" from Last.fm`,
      );
    }
  }
}

