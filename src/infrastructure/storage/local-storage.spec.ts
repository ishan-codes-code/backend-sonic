import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import type * as osType from 'os';
import { join } from 'path';
import {
  buildLocalR2Key,
  ensureLocalMusicDir,
  getLocalMusicDir,
  getLocalSongPath,
  getLocalSongPathFromR2Key,
  isPathInsideDir,
  isValidYoutubeId,
  localSongFileExists,
  parseLocalR2Key,
  verifyLocalMusicDir,
} from './local-storage';

describe('local storage paths', () => {
  // os.homedir() reads the real process environment, which the jest sandbox
  // cannot change via process.env, so tests point it at a temp home instead.
  const osActual = jest.requireActual('os') as typeof osType;
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'sonic-home-'));
    jest.spyOn(osActual, 'homedir').mockReturnValue(home);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(home, { recursive: true, force: true });
  });

  it('resolves the music folder from the home directory as ~/songs', () => {
    expect(getLocalMusicDir()).toBe(join(home, 'songs'));
  });

  it.each(['dQw4w9WgXcQ', 'vid123', 'a', 'A-_09'])(
    'accepts youtube id %s',
    (id) => {
      expect(isValidYoutubeId(id)).toBe(true);
    },
  );

  it.each([
    '',
    '../x',
    '..',
    'a/b',
    'x.m4a',
    'x m4a',
    'x\0y',
    'é',
    'a'.repeat(65),
    'songs/abc',
  ])('rejects youtube id %s', (id) => {
    expect(isValidYoutubeId(id)).toBe(false);
  });

  it('parses only the expected songs/<youtubeId>.m4a form', () => {
    expect(parseLocalR2Key('songs/abc123.m4a')).toBe('abc123');
    expect(parseLocalR2Key('songs/../x.m4a')).toBeNull();
    expect(parseLocalR2Key('songs/a/b.m4a')).toBeNull();
    expect(parseLocalR2Key('songs/.m4a')).toBeNull();
    expect(parseLocalR2Key('songs/abc123.mp3')).toBeNull();
    expect(parseLocalR2Key('other/abc123.m4a')).toBeNull();
    expect(parseLocalR2Key('songs/abc123.m4a/extra')).toBeNull();
    expect(parseLocalR2Key('')).toBeNull();
    expect(parseLocalR2Key(null as unknown as string)).toBeNull();
  });

  it('builds the existing r2_key format without another songs folder', () => {
    expect(buildLocalR2Key('abc123')).toBe('songs/abc123.m4a');
    expect(buildLocalR2Key('../abc123')).toBeNull();
  });

  it('joins the home directory with the r2_key for ~/songs/<youtubeId>.m4a', () => {
    expect(getLocalSongPath('abc123')).toBe(join(home, 'songs', 'abc123.m4a'));
    expect(getLocalSongPath('../abc123')).toBeNull();
    expect(getLocalSongPathFromR2Key('songs/abc123.m4a')).toBe(
      join(home, 'songs', 'abc123.m4a'),
    );
    expect(getLocalSongPathFromR2Key('songs/../abc123.m4a')).toBeNull();
  });

  it('detects paths escaping the music folder', () => {
    const dir = join(home, 'songs');
    expect(isPathInsideDir(dir, join(dir, 'a.m4a'))).toBe(true);
    expect(isPathInsideDir(dir, join(dir, '..', 'x.m4a'))).toBe(false);
    expect(isPathInsideDir(dir, join(home, 'songs-evil', 'a.m4a'))).toBe(false);
    expect(isPathInsideDir(dir, dir)).toBe(false);
  });

  it('reports existence only for regular files inside ~/songs', () => {
    const dir = ensureLocalMusicDir();
    expect(localSongFileExists('songs/missing.m4a')).toBe(false);

    writeFileSync(join(dir, 'abc123.m4a'), 'audio');
    expect(localSongFileExists('songs/abc123.m4a')).toBe(true);

    mkdirSync(join(dir, 'dir.m4a'));
    expect(localSongFileExists('songs/dir.m4a')).toBe(false);

    symlinkSync(join(dir, 'abc123.m4a'), join(dir, 'link1234567.m4a'));
    expect(localSongFileExists('songs/link1234567.m4a')).toBe(false);

    expect(localSongFileExists('songs/../outside.m4a')).toBe(false);
    writeFileSync(join(home, 'outside.m4a'), 'nope');
    expect(localSongFileExists('songs/../outside.m4a')).toBe(false);
  });

  it('verifies write, read, and delete, leaving no probe files behind', () => {
    const { dir } = verifyLocalMusicDir();

    expect(dir).toBe(join(home, 'songs'));
    expect(existsSync(dir)).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('keeps unrelated files in an already-existing ~/songs', () => {
    const dir = join(home, 'songs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'notes.txt'), 'keep me');
    writeFileSync(join(dir, 'existing.m4a'), 'keep me too');

    verifyLocalMusicDir();

    expect(readFileSync(join(dir, 'notes.txt'), 'utf8')).toBe('keep me');
    expect(readFileSync(join(dir, 'existing.m4a'), 'utf8')).toBe('keep me too');
    expect(
      readdirSync(dir).filter((name) => name.startsWith('.sonic-write-test')),
    ).toEqual([]);
  });

  it('fails clearly when ~/songs cannot be used, with no fallback', () => {
    writeFileSync(join(home, 'songs'), 'blocking file');

    expect(() => verifyLocalMusicDir()).toThrow(/Local storage setup failed/);
    expect(readFileSync(join(home, 'songs'), 'utf8')).toBe('blocking file');
  });
});
