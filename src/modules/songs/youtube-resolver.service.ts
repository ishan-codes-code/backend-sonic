import axios from 'axios';
import {
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { HttpException } from '@nestjs/common';
import { lastValueFrom } from 'rxjs';
import { normalizeString } from '../../shared/utils/string.utils';

interface YoutubeSearchItem {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    thumbnails?: {
      high?: { url?: string };
      medium?: { url?: string };
      default?: { url?: string };
    };
  };
}

interface YoutubeSearchResponse {
  items?: YoutubeSearchItem[];
}

export interface ResolvedYoutubeSong {
  youtubeId: string;
  youtubeTitle: string;
  normalizedTrackName: string;
  normalizedArtistName: string;
  image: string | null;
  duration?: number;
}

@Injectable()
export class YoutubeResolverService {
  private readonly logger = new Logger(YoutubeResolverService.name);

  constructor(private readonly httpService: HttpService) { }



  private scoreVideo(item: YoutubeSearchItem, normalizedArtist: string): number {
    const title = item.snippet?.title?.toLowerCase() ?? '';
    const channel = item.snippet?.channelTitle?.toLowerCase() ?? '';

    let score = 0;

    const isTopic = channel.includes('topic');

    // 🎯 STRONG SIGNALS
    if (isTopic) score += 20;

    if (title.includes('official audio')) {
      score += 12;
    } else if (title.includes('audio')) {
      score += 2;
    }

    // 🎬 Official video
    if (title.includes('official music video')) score += 8;
    else if (title.includes('official video')) score += 6;

    // 🎤 Matching
    if (title.includes(normalizedArtist)) score += 6;
    if (channel.includes(normalizedArtist)) score += 6;

    // 📺 Trusted channels
    if (channel.includes('vevo')) score += 5;

    // ❌ NEGATIVE SIGNALS
    if (title.includes('remix')) score -= 6;
    if (title.includes('live')) score -= 5;
    if (title.includes('cover')) score -= 6;
    if (title.includes('lyrics')) score -= 6;
    if (title.includes('karaoke')) score -= 8;

    return score;
  }



  async resolveFromTrackAndArtist(
    trackName: string,
    artistName: string,
  ): Promise<ResolvedYoutubeSong> {
    const youtubeApiKey = process.env.YOUTUBE_API_KEY;
    if (!youtubeApiKey) {
      throw new InternalServerErrorException('YOUTUBE_API_KEY is not configured');
    }

    const normalizedTrackName = normalizeString(trackName);
    const normalizedArtistName = normalizeString(artistName);
    const query = `${trackName} ${artistName}`;

    try {
      const response = await lastValueFrom(
        this.httpService.get<YoutubeSearchResponse>(
          'https://www.googleapis.com/youtube/v3/search',
          {
            params: {
              key: youtubeApiKey,
              part: 'snippet',
              type: 'video',
              maxResults: 5,
              videoCategoryId: 10,
              q: `${query} official audio`,
            },
            timeout: 5000,
          },
        ),
      );

      const items = (response.data.items ?? []).filter(
        (item) => item.id?.videoId && item.snippet?.title,
      );

      if (items.length === 0) {
        throw new HttpException(
          'No playable YouTube match found for this song',
          HttpStatus.NOT_FOUND,
        );
      }

      const bestMatch = items
        .map((item) => ({
          item,
          score: this.scoreVideo(item, normalizedArtistName),
        }))
        .sort((a, b) => b.score - a.score)[0]?.item;

      if (!bestMatch?.id?.videoId || !bestMatch.snippet?.title) {
        throw new HttpException(
          'No playable YouTube match found for this song',
          HttpStatus.NOT_FOUND,
        );
      }

      return {
        youtubeId: bestMatch.id.videoId,
        youtubeTitle: bestMatch.snippet.title.trim(),
        normalizedTrackName,
        normalizedArtistName,
        image: await getYoutubeThumbnail(
          bestMatch.id.videoId,
          bestMatch.snippet.thumbnails?.high?.url ??
          bestMatch.snippet.thumbnails?.medium?.url ??
          bestMatch.snippet.thumbnails?.default?.url ??
          null,
        ),

      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('YouTube resolution failed', error);
      throw new InternalServerErrorException(
        'Failed to resolve YouTube video for playback',
      );
    }
  }
}

export async function getYoutubeThumbnail(
  videoId: string,
  fallback: string | null,
): Promise<string | null> {
  const maxresUrl = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;

  try {
    const res = await axios.head(maxresUrl, { timeout: 5000 });

    if (res.status === 200) {
      return maxresUrl;
    }
  } catch (err) {
    // maxres not available
  }

  return fallback;
}
