import { RecommendationService } from './recommendation.service';
import { LastFmService } from '../../services/lastfm.service';
import { ListeningService } from '../listening/listening.service';

describe('RecommendationService', () => {
  let service: RecommendationService;
  let lastFmService: jest.Mocked<Pick<LastFmService, 'getSimilarTracks'>>;
  let listeningService: jest.Mocked<Pick<ListeningService, 'getUserHistory'>>;

  beforeEach(() => {
    lastFmService = {
      getSimilarTracks: jest.fn(),
    };
    listeningService = {
      getUserHistory: jest.fn(),
    };

    service = new RecommendationService(
      lastFmService as any,
      listeningService as any,
    );
  });

  it('uses recent songs as seeds, merges similar tracks, dedupes, and returns lastfm ids', async () => {
    listeningService.getUserHistory.mockResolvedValue([
      historyEvent('seed-1', 'Seed One', 'Artist One'),
      historyEvent('seed-2', 'Seed Two', 'Artist Two'),
    ] as any);

    lastFmService.getSimilarTracks
      .mockResolvedValueOnce([
        {
          title: 'Shared Track',
          artist: 'Shared Artist',
          image: 'https://img/shared.png',
          duration: 180,
          lastfmId: 'shared track-shared artist',
        },
        {
          title: 'Seed Two',
          artist: 'Artist Two',
          image: null,
          duration: null,
          lastfmId: 'seed two-artist two',
        },
      ])
      .mockResolvedValueOnce([
        {
          title: 'Shared Track ',
          artist: ' Shared Artist',
          image: null,
          duration: 181,
          lastfmId: 'shared track-shared artist',
        },
        {
          title: 'Fresh Track',
          artist: 'Fresh Artist',
          image: null,
          duration: null,
          lastfmId: null,
        },
      ]);

    await expect(service.getRecommendationsForUser('user-1', 10)).resolves.toEqual([
      {
        trackName: 'Shared Track',
        artistName: 'Shared Artist',
        image: 'https://img/shared.png',
        duration: 180,
        lastfmId: 'shared track-shared artist',
        score: 1.175,
      },
      {
        trackName: 'Fresh Track',
        artistName: 'Fresh Artist',
        image: null,
        duration: null,
        lastfmId: null,
        score: 0.3536,
      },
    ]);
    expect(lastFmService.getSimilarTracks).toHaveBeenCalledTimes(2);
  });

  it('uses the cache for the same recent seed signature', async () => {
    listeningService.getUserHistory.mockResolvedValue([
      historyEvent('seed-1', 'Seed One', 'Artist One'),
    ] as any);
    lastFmService.getSimilarTracks.mockResolvedValue([
      {
        title: 'Track One',
        artist: 'Artist One',
        image: null,
        duration: null,
        lastfmId: 'track one-artist one',
      },
      {
        title: 'Track Two',
        artist: 'Artist Two',
        image: null,
        duration: null,
        lastfmId: null,
      },
    ]);

    const first = await service.getRecommendationsForUser('user-1', 1);
    const second = await service.getRecommendationsForUser('user-1', 2);

    expect(first).toEqual([
      {
        trackName: 'Track One',
        artistName: 'Artist One',
        image: null,
        duration: null,
        lastfmId: 'track one-artist one',
        score: 1,
      },
    ]);
    expect(second).toHaveLength(2);
    expect(lastFmService.getSimilarTracks).toHaveBeenCalledTimes(1);
  });

  it('returns an empty queue when there are no recent songs', async () => {
    listeningService.getUserHistory.mockResolvedValue([]);

    await expect(service.getRecommendationsForUser('user-1', 5)).resolves.toEqual([]);
    expect(lastFmService.getSimilarTracks).not.toHaveBeenCalled();
  });
});

function historyEvent(id: string, trackName: string, artistName: string) {
  return {
    id: `event-${id}`,
    song: {
      id,
      trackName,
      artists: [{ name: artistName, normalizedName: artistName.toLowerCase() }],
    },
  };
}
