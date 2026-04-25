import { RecommendationService } from './recommendation.service';
import { LastFmService } from '../../services/lastfm.service';
import { SongCatalogService } from '../songs/song-catalog.service';
import { YoutubeResolverService } from '../youtube/youtube-resolver.service';

describe('RecommendationService', () => {
  let service: RecommendationService;
  let lastFmService: jest.Mocked<
    Pick<LastFmService, 'getSimilarTracks'>
  >;
  let youtubeResolverService: jest.Mocked<Pick<YoutubeResolverService, 'isQuotaExhausted'>>;
  let songCatalogService: jest.Mocked<Pick<SongCatalogService, 'findByNormalizedTrackArtist'>>;

  const mockArtists = [{ name: 'Seed Artist', normalizedName: 'seed artist' }];

  beforeEach(() => {
    lastFmService = {
      getSimilarTracks: jest.fn(),
    };
    youtubeResolverService = {
      isQuotaExhausted: jest.fn().mockReturnValue(false),
    };
    songCatalogService = {
      findByNormalizedTrackArtist: jest.fn(),
    };

    service = new RecommendationService(
      lastFmService as any,
      youtubeResolverService as any,
      songCatalogService as any,
    );
  });

  it('filters invalid and duplicate recommendations', async () => {
    lastFmService.getSimilarTracks.mockResolvedValue([
      { title: 'Track One', artist: 'Artist One', image: 'https://img/1.png' },
      {
        title: 'Track One ',
        artist: ' Artist One',
        image: 'https://img/duplicate.png',
      },
      { title: '', artist: 'Artist Two', image: null },
      { title: 'Track Three', artist: '', image: null },
      { title: 'Track Four', artist: 'Artist Four', image: null },
    ]);

    await expect(
      service.getRecommendations('Seed Title', mockArtists, 10),
    ).resolves.toEqual([
      { trackName: 'Track One', artistName: 'Artist One', image: 'https://img/1.png', duration: null },
      { trackName: 'Track Four', artistName: 'Artist Four', image: null, duration: null },
    ]);
  });

  it('uses the in-memory cache for repeated requests within the ttl', async () => {
    lastFmService.getSimilarTracks.mockResolvedValue([
      { title: 'Track One', artist: 'Artist One', image: null },
      { title: 'Track Two', artist: 'Artist Two', image: null },
    ]);

    const first = await service.getRecommendations(
      'Seed Title',
      mockArtists,
      1,
    );
    const second = await service.getRecommendations(
      'Seed Title',
      mockArtists,
      2,
    );

    expect(first).toEqual([
      { trackName: 'Track One', artistName: 'Artist One', image: null, duration: null },
    ]);
    expect(second).toEqual([
      { trackName: 'Track One', artistName: 'Artist One', image: null, duration: null },
      { trackName: 'Track Two', artistName: 'Artist Two', image: null, duration: null },
    ]);
    expect(lastFmService.getSimilarTracks).toHaveBeenCalledTimes(1);
  });

  it('returns an empty array when the Last.fm request fails', async () => {
    lastFmService.getSimilarTracks.mockRejectedValue(new Error('boom'));

    await expect(
      service.getRecommendations('Seed Title', mockArtists, 5),
    ).resolves.toEqual([]);
  });
});
