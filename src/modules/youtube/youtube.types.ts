export interface YoutubeSearchItem {
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

export interface YoutubeSearchResponse {
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
