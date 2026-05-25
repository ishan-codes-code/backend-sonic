export interface YoutubeSearchItem {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
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
  duration?: number;
}
