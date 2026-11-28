import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  reloadRuntimeConfig,
  saveRuntimeConfig,
} from '../../../infrastructure/config/runtime-config';
import { Song, toSongDto } from './play-response.dto';

const ENV_KEYS = [
  'CONFIG_PATH',
  'STORAGE_MODE',
  'WORKER_STREAM_URL',
  'JWT_PLAYBACK_SECRET',
];

function makeSong(): Song {
  return {
    id: 'song-id',
    youtubeId: 'abc123',
    r2Key: 'songs/abc123.m4a',
    trackName: 'Track',
    normalizedTrackName: 'track',
    duration: 200,
    albumName: null,
    image: null,
    externalId: null,
    lastfmId: null,
    youtubeTitle: null,
    isVerified: false,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    artists: [],
  };
}

describe('toSongDto storage modes', () => {
  let directory: string;
  let previousEnv: Record<string, string | undefined>;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'sonic-dto-config-'));
    previousEnv = {};
    for (const key of ENV_KEYS) {
      previousEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.CONFIG_PATH = join(directory, 'config.json');
    reloadRuntimeConfig({ readOnly: true });
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
    reloadRuntimeConfig({ readOnly: true });
    rmSync(directory, { recursive: true, force: true });
  });

  it('keeps the r2 worker stream URL by default', () => {
    saveRuntimeConfig({ WORKER_STREAM_URL: 'https://worker.example.com' });

    const dto = toSongDto(makeSong());

    expect(dto.streamUrl).toBe('https://worker.example.com/stream/abc123');
    expect(dto.youtubeId).toBe('abc123');
  });

  it('keeps the r2 fallback when no stream URL is configured', () => {
    const dto = toSongDto(makeSong());

    expect(dto.streamUrl).toBe('http://127.0.0.1:8787/stream/abc123');
  });

  it('ignores the request base in r2 mode', () => {
    saveRuntimeConfig({
      STORAGE_MODE: 'r2',
      WORKER_STREAM_URL: 'https://worker.example.com',
    });

    const dto = toSongDto(makeSong(), 'http://192.168.1.5:3000');

    expect(dto.streamUrl).toBe('https://worker.example.com/stream/abc123');
  });

  it('builds the local stream URL from the request base', () => {
    saveRuntimeConfig({ STORAGE_MODE: 'local' });

    const dto = toSongDto(makeSong(), 'http://192.168.1.5:3000');

    expect(dto.streamUrl).toBe('http://192.168.1.5:3000/stream/abc123');
  });

  it('requires the request base in local mode', () => {
    saveRuntimeConfig({ STORAGE_MODE: 'local' });

    expect(() => toSongDto(makeSong())).toThrow(/request API base URL/);
  });
});
