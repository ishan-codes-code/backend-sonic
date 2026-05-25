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

    await expect(
      service.getRecommendationsForUser('user-1', 10),
    ).resolves.toEqual([
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

    await expect(
      service.getRecommendationsForUser('user-1', 5),
    ).resolves.toEqual([]);
    expect(lastFmService.getSimilarTracks).not.toHaveBeenCalled();
  });

  it('prioritizes the latest song only when it is manual while still blending recent history', async () => {
    listeningService.getUserHistory.mockResolvedValue([
      historyEvent('manual-seed', 'Manual Seed', 'Manual Artist', true),
      historyEvent('auto-seed', 'Auto Seed', 'Auto Artist', false),
    ] as any);

    lastFmService.getSimilarTracks
      .mockResolvedValueOnce([
        {
          title: 'Manual Similar',
          artist: 'Manual Similar Artist',
          image: null,
          duration: null,
          lastfmId: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          title: 'Auto Similar',
          artist: 'Auto Similar Artist',
          image: null,
          duration: null,
          lastfmId: null,
        },
      ]);

    await expect(
      service.getRecommendationsForUser('user-1', 10),
    ).resolves.toEqual([
      {
        trackName: 'Manual Similar',
        artistName: 'Manual Similar Artist',
        image: null,
        duration: null,
        lastfmId: null,
        score: 1,
      },
      {
        trackName: 'Auto Similar',
        artistName: 'Auto Similar Artist',
        image: null,
        duration: null,
        lastfmId: null,
        score: 0.5,
      },
    ]);

    expect(lastFmService.getSimilarTracks).toHaveBeenCalledTimes(2);
    expect(lastFmService.getSimilarTracks).toHaveBeenCalledWith(
      'Manual Seed',
      'Manual Artist',
      expect.any(Number),
    );
    expect(lastFmService.getSimilarTracks).toHaveBeenCalledWith(
      'Auto Seed',
      'Auto Artist',
      expect.any(Number),
    );
  });

  it('keeps normal recency order when the latest song is autoplayed even if older songs were manual', async () => {
    listeningService.getUserHistory.mockResolvedValue([
      historyEvent('auto-seed', 'Auto Seed', 'Auto Artist', false),
      historyEvent('manual-seed', 'Manual Seed', 'Manual Artist', true),
    ] as any);

    lastFmService.getSimilarTracks
      .mockResolvedValueOnce([
        {
          title: 'Auto Similar',
          artist: 'Auto Similar Artist',
          image: null,
          duration: null,
          lastfmId: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          title: 'Manual Similar',
          artist: 'Manual Similar Artist',
          image: null,
          duration: null,
          lastfmId: null,
        },
      ]);

    await expect(
      service.getRecommendationsForUser('user-1', 10),
    ).resolves.toEqual([
      {
        trackName: 'Auto Similar',
        artistName: 'Auto Similar Artist',
        image: null,
        duration: null,
        lastfmId: null,
        score: 1,
      },
      {
        trackName: 'Manual Similar',
        artistName: 'Manual Similar Artist',
        image: null,
        duration: null,
        lastfmId: null,
        score: 0.5,
      },
    ]);

    expect(lastFmService.getSimilarTracks).toHaveBeenNthCalledWith(
      1,
      'Auto Seed',
      'Auto Artist',
      expect.any(Number),
    );
    expect(lastFmService.getSimilarTracks).toHaveBeenNthCalledWith(
      2,
      'Manual Seed',
      'Manual Artist',
      expect.any(Number),
    );
  });

  it('boosts recommendation scores for completed songs with high listened duration', async () => {
    listeningService.getUserHistory.mockResolvedValue([
      historyEvent('strong-seed', 'Strong Seed', 'Strong Artist', false, {
        completed: true,
        durationListenedSeconds: 180,
        songDuration: 200,
      }),
      historyEvent('normal-seed', 'Normal Seed', 'Normal Artist'),
    ] as any);

    lastFmService.getSimilarTracks
      .mockResolvedValueOnce([
        {
          title: 'Strong Similar',
          artist: 'Strong Similar Artist',
          image: null,
          duration: null,
          lastfmId: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          title: 'Normal Similar',
          artist: 'Normal Similar Artist',
          image: null,
          duration: null,
          lastfmId: null,
        },
      ]);

    await expect(
      service.getRecommendationsForUser('user-1', 10),
    ).resolves.toEqual([
      {
        trackName: 'Strong Similar',
        artistName: 'Strong Similar Artist',
        image: null,
        duration: null,
        lastfmId: null,
        score: 1.4,
      },
      {
        trackName: 'Normal Similar',
        artistName: 'Normal Similar Artist',
        image: null,
        duration: null,
        lastfmId: null,
        score: 0.5,
      },
    ]);
  });
});

function historyEvent(
  id: string,
  trackName: string,
  artistName: string,
  isManualAdd = false,
  options: {
    completed?: boolean;
    durationListenedSeconds?: number;
    songDuration?: number;
  } = {},
) {
  return {
    id: `event-${id}`,
    isManualAdd,
    completed: options.completed ?? false,
    durationListenedSeconds: options.durationListenedSeconds ?? 0,
    song: {
      id,
      trackName,
      duration: options.songDuration ?? 200,
      artists: [{ name: artistName, normalizedName: artistName.toLowerCase() }],
    },
  };
}
