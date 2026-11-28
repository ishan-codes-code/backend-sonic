import { DrizzleQueryError } from 'drizzle-orm/errors';
import {
  isUniqueViolation,
  SongProcessorService,
} from './song-processor.service';

function createService(deps: {
  findByYoutubeId?: jest.Mock;
  tryGetStreamUrl?: jest.Mock;
  downloadAudio?: jest.Mock;
  create?: jest.Mock;
  updateR2Key?: jest.Mock;
  linkArtistsToSong?: jest.Mock;
}) {
  const songFilesService = {
    downloadAudio:
      deps.downloadAudio ?? jest.fn().mockResolvedValue({ success: true }),
  };
  const songCatalogService = {
    findByYoutubeId: deps.findByYoutubeId ?? jest.fn(),
    create: deps.create ?? jest.fn(),
    updateR2Key: deps.updateR2Key ?? jest.fn(),
  };
  const songStreamService = {
    tryGetStreamUrl: deps.tryGetStreamUrl ?? jest.fn(),
  };
  const artistService = {
    linkArtistsToSong: deps.linkArtistsToSong ?? jest.fn(),
  };
  const service = new SongProcessorService(
    songFilesService as any,
    songCatalogService as any,
    songStreamService as any,
    artistService as any,
    {} as any,
    {} as any,
  );
  return {
    service,
    songFilesService,
    songCatalogService,
    songStreamService,
    artistService,
  };
}

const JOB = {
  youtubeId: 'vid123',
  trackName: 'Track',
  artistName: 'Artist One, Artist Two',
  normalizedTrackName: 'track',
  normalizedArtistName: 'artist one, artist two',
  youtubeTitle: 'Artist - Track',
  image: null,
  externalId: undefined,
  lastfmId: undefined,
};

function pgError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('SongProcessorService duplicate handling', () => {
  it('updates the existing row when its content is missing instead of inserting', async () => {
    const existing = {
      id: 'song-id',
      youtubeId: 'vid123',
      r2Key: 'songs/vid123.m4a',
      trackName: 'Track',
    };
    const updated = { ...existing, duration: 200 };
    const {
      service,
      songCatalogService,
      songFilesService,
      songStreamService,
      artistService,
    } = createService({
      findByYoutubeId: jest.fn().mockResolvedValue(existing),
      // Step 1: content missing; final verification: available.
      tryGetStreamUrl: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValue('https://stream/vid123'),
      downloadAudio: jest.fn().mockResolvedValue({
        success: true,
        r2Key: 'songs/vid123.m4a',
        duration: 200,
      }),
      updateR2Key: jest.fn().mockResolvedValue(updated),
    });

    await expect((service as any).processJob(JOB)).resolves.toBeUndefined();

    expect(songFilesService.downloadAudio).toHaveBeenCalledWith('vid123');
    expect(songCatalogService.create).not.toHaveBeenCalled();
    expect(songCatalogService.updateR2Key).toHaveBeenCalledWith(
      'vid123',
      'songs/vid123.m4a',
      200,
    );
    expect(artistService.linkArtistsToSong).toHaveBeenCalledWith('song-id', [
      'Artist One',
      'Artist Two',
    ]);
  });

  it('updates the row when a concurrent insert raises a wrapped unique violation', async () => {
    const inserted = { id: 'song-id', youtubeId: 'vid123' };
    const wrapped = new DrizzleQueryError(
      'insert into "songs" ...',
      [],
      pgError('23505', 'duplicate key value violates unique constraint'),
    );
    expect(wrapped.message).not.toContain('duplicate key value');

    const { service, songCatalogService, artistService } = createService({
      findByYoutubeId: jest.fn().mockResolvedValue(null),
      tryGetStreamUrl: jest.fn().mockResolvedValue('https://stream/vid123'),
      downloadAudio: jest.fn().mockResolvedValue({
        success: true,
        r2Key: 'songs/vid123.m4a',
        duration: 200,
      }),
      create: jest.fn().mockRejectedValue(wrapped),
      updateR2Key: jest.fn().mockResolvedValue(inserted),
    });

    await expect((service as any).processJob(JOB)).resolves.toBeUndefined();

    expect(songCatalogService.create).toHaveBeenCalledTimes(1);
    expect(songCatalogService.updateR2Key).toHaveBeenCalledWith(
      'vid123',
      'songs/vid123.m4a',
      200,
    );
    expect(artistService.linkArtistsToSong).toHaveBeenCalledWith(
      'song-id',
      expect.any(Array),
    );
  });

  it('rethrows database errors that are not unique violations', async () => {
    const wrapped = new DrizzleQueryError(
      'insert into "songs" ...',
      [],
      pgError('23503', 'insert violates foreign key constraint'),
    );
    const { service, songCatalogService } = createService({
      findByYoutubeId: jest.fn().mockResolvedValue(null),
      downloadAudio: jest.fn().mockResolvedValue({
        success: true,
        r2Key: 'songs/vid123.m4a',
        duration: 200,
      }),
      create: jest.fn().mockRejectedValue(wrapped),
      updateR2Key: jest.fn(),
    });

    await expect((service as any).processJob(JOB)).rejects.toBe(wrapped);
    expect(songCatalogService.updateR2Key).not.toHaveBeenCalled();
  });

  it('skips work when the song content is already available', async () => {
    const { service, songFilesService, songCatalogService } = createService({
      findByYoutubeId: jest.fn().mockResolvedValue({
        id: 'song-id',
        youtubeId: 'vid123',
        r2Key: 'songs/vid123.m4a',
      }),
      tryGetStreamUrl: jest.fn().mockResolvedValue('https://stream/vid123'),
      downloadAudio: jest.fn(),
      create: jest.fn(),
      updateR2Key: jest.fn(),
    });

    await expect((service as any).processJob(JOB)).resolves.toBeUndefined();

    expect(songFilesService.downloadAudio).not.toHaveBeenCalled();
    expect(songCatalogService.create).not.toHaveBeenCalled();
    expect(songCatalogService.updateR2Key).not.toHaveBeenCalled();
  });
});

describe('isUniqueViolation', () => {
  it.each([
    ['driver code', { code: '23505' }, true],
    ['driver message', { message: 'duplicate key value x' }, true],
    [
      'drizzle-wrapped cause',
      new DrizzleQueryError('q', [], pgError('23505', 'duplicate key value')),
      true,
    ],
    ['deeply nested cause', { cause: { cause: { code: '23505' } } }, true],
    ['other code', { code: '23503', message: 'fk' }, false],
    ['plain error', new Error('boom'), false],
    ['null', null, false],
    ['string', '23505', false],
  ])('%s -> %s', (_label, error, expected) => {
    expect(isUniqueViolation(error)).toBe(expected);
  });

  it('survives a cyclic cause chain', () => {
    const cyclic: any = { message: 'loop' };
    cyclic.cause = cyclic;
    expect(isUniqueViolation(cyclic)).toBe(false);
  });
});
