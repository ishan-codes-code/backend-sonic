import { RecommendationService } from './recommendation.service';
import { LastFmService } from '../../services/lastfm.service';

describe('RecommendationService', () => {
  let service: RecommendationService;
  let lastFmService: jest.Mocked<
    Pick<LastFmService, 'getSimilarTracks' | 'normalizeString'>
  >;

  beforeEach(() => {
    lastFmService = {
      getSimilarTracks: jest.fn(),
      normalizeString: jest.fn((value: string) => value.trim().toLowerCase()),
    };

    service = new RecommendationService(
      lastFmService as unknown as LastFmService,
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
      service.getRecommendations('Seed Title', 'Seed Artist', 10),
    ).resolves.toEqual([
      { title: 'Track One', artist: 'Artist One', image: 'https://img/1.png' },
      { title: 'Track Four', artist: 'Artist Four', image: null },
    ]);
  });

  it('uses the in-memory cache for repeated requests within the ttl', async () => {
    lastFmService.getSimilarTracks.mockResolvedValue([
      { title: 'Track One', artist: 'Artist One', image: null },
      { title: 'Track Two', artist: 'Artist Two', image: null },
    ]);

    const first = await service.getRecommendations(
      'Seed Title',
      'Seed Artist',
      1,
    );
    const second = await service.getRecommendations(
      'Seed Title',
      'Seed Artist',
      2,
    );

    expect(first).toEqual([
      { title: 'Track One', artist: 'Artist One', image: null },
    ]);
    expect(second).toEqual([
      { title: 'Track One', artist: 'Artist One', image: null },
      { title: 'Track Two', artist: 'Artist Two', image: null },
    ]);
    expect(lastFmService.getSimilarTracks).toHaveBeenCalledTimes(1);
  });

  it('returns an empty array when the Last.fm request fails', async () => {
    lastFmService.getSimilarTracks.mockRejectedValue(new Error('boom'));

    await expect(
      service.getRecommendations('Seed Title', 'Seed Artist', 5),
    ).resolves.toEqual([]);
  });
});
