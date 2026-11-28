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
  assertMusicDirCurrent,
  buildLocalR2Key,
  closeValidatedMusicDir,
  copyFileIntoMusicDir,
  ensureLocalMusicDir,
  getLocalMusicDir,
  getLocalSongPath,
  getLocalSongPathFromR2Key,
  isMusicDirCurrent,
  isPathInsideDir,
  isSafeLeafName,
  isValidYoutubeId,
  localSongFileExists,
  openValidatedMusicDir,
  parseLocalR2Key,
  renameInMusicDir,
  unlinkInMusicDir,
  UnsafeMusicDirError,
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

describe('music directory safety', () => {
  // os.homedir() reads the real process environment, which the jest sandbox
  // cannot change via process.env, so tests point it at a temp home instead.
  const osActual = jest.requireActual('os') as typeof osType;
  let home: string;
  let outside: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'sonic-safe-home-'));
    outside = mkdtempSync(join(tmpdir(), 'sonic-outside-'));
    jest.spyOn(osActual, 'homedir').mockReturnValue(home);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(home, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('opens a normal ~/songs directory and detects it as current', () => {
    mkdirSync(join(home, 'songs'), { recursive: true });

    const handle = openValidatedMusicDir();
    try {
      expect(handle.dir).toBe(join(home, 'songs'));
      expect(isMusicDirCurrent(handle)).toBe(true);
      expect(() => assertMusicDirCurrent(handle)).not.toThrow();
    } finally {
      closeValidatedMusicDir(handle);
    }
  });

  it('closes handles safely more than once', () => {
    mkdirSync(join(home, 'songs'), { recursive: true });

    const handle = openValidatedMusicDir();
    closeValidatedMusicDir(handle);
    expect(() => closeValidatedMusicDir(handle)).not.toThrow();
  });

  it('rejects a missing ~/songs without creating anything', () => {
    expect(() => openValidatedMusicDir()).toThrow(UnsafeMusicDirError);
    expect(existsSync(join(home, 'songs'))).toBe(false);
  });

  it('rejects a ~/songs symlink pointing outside the home directory', () => {
    writeFileSync(join(outside, 'abc123.m4a'), 'outside-bytes');
    symlinkSync(outside, join(home, 'songs'));

    expect(() => openValidatedMusicDir()).toThrow(UnsafeMusicDirError);
    expect(() => openValidatedMusicDir()).toThrow(/symlink/);
    expect(() => ensureLocalMusicDir()).toThrow(UnsafeMusicDirError);
    expect(() => verifyLocalMusicDir()).toThrow(/Local storage setup failed/);
    expect(localSongFileExists('songs/abc123.m4a')).toBe(false);
    // Nothing was written through the symlink.
    expect(readdirSync(outside)).toEqual(['abc123.m4a']);
  });

  it('rejects a ~/songs symlink pointing inside the home directory', () => {
    mkdirSync(join(home, 'real-target'));
    symlinkSync(join(home, 'real-target'), join(home, 'songs'));

    expect(() => openValidatedMusicDir()).toThrow(UnsafeMusicDirError);
    expect(() => verifyLocalMusicDir()).toThrow(/Local storage setup failed/);
  });

  it('detects the directory being swapped for a symlink after validation', () => {
    const dir = ensureLocalMusicDir();
    const handle = openValidatedMusicDir();
    try {
      expect(isMusicDirCurrent(handle)).toBe(true);

      rmSync(dir, { recursive: true, force: true });
      symlinkSync(outside, dir);

      expect(isMusicDirCurrent(handle)).toBe(false);
      expect(() => assertMusicDirCurrent(handle)).toThrow(UnsafeMusicDirError);
    } finally {
      closeValidatedMusicDir(handle);
    }
  });

  it('detects the directory being replaced by a new directory', () => {
    const dir = ensureLocalMusicDir();
    const handle = openValidatedMusicDir();
    try {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir);

      expect(isMusicDirCurrent(handle)).toBe(false);
    } finally {
      closeValidatedMusicDir(handle);
    }
  });

  it('copies, renames, and deletes leaves inside a normal directory', () => {
    ensureLocalMusicDir();
    const handle = openValidatedMusicDir();
    try {
      const source = join(home, 'source.m4a');
      writeFileSync(source, 'song-bytes');

      copyFileIntoMusicDir(handle, source, '.tmp-copy.tmp');
      expect(readFileSync(join(home, 'songs', '.tmp-copy.tmp'), 'utf8')).toBe(
        'song-bytes',
      );

      renameInMusicDir(handle, '.tmp-copy.tmp', 'final123.m4a');
      expect(existsSync(join(home, 'songs', '.tmp-copy.tmp'))).toBe(false);
      expect(readFileSync(join(home, 'songs', 'final123.m4a'), 'utf8')).toBe(
        'song-bytes',
      );

      unlinkInMusicDir(handle, 'final123.m4a');
      expect(existsSync(join(home, 'songs', 'final123.m4a'))).toBe(false);
    } finally {
      closeValidatedMusicDir(handle);
    }
  });

  it('refuses to overwrite through an existing symlink during copy', () => {
    ensureLocalMusicDir();
    const handle = openValidatedMusicDir();
    try {
      const source = join(home, 'source.m4a');
      writeFileSync(source, 'song-bytes');
      writeFileSync(join(outside, 'victim.txt'), 'original');
      symlinkSync(
        join(outside, 'victim.txt'),
        join(home, 'songs', 'plant.tmp'),
      );

      expect(() => copyFileIntoMusicDir(handle, source, 'plant.tmp')).toThrow();
      expect(readFileSync(join(outside, 'victim.txt'), 'utf8')).toBe(
        'original',
      );
    } finally {
      closeValidatedMusicDir(handle);
    }
  });

  it('refuses helper operations once the directory is swapped', () => {
    const dir = ensureLocalMusicDir();
    const handle = openValidatedMusicDir();
    const source = join(home, 'source.m4a');
    writeFileSync(source, 'song-bytes');

    rmSync(dir, { recursive: true, force: true });
    symlinkSync(outside, dir);

    try {
      expect(() => copyFileIntoMusicDir(handle, source, 'evil.tmp')).toThrow(
        UnsafeMusicDirError,
      );
      expect(() => renameInMusicDir(handle, 'a.tmp', 'b.m4a')).toThrow(
        UnsafeMusicDirError,
      );
      expect(() => unlinkInMusicDir(handle, 'a.tmp')).toThrow(
        UnsafeMusicDirError,
      );
      expect(readdirSync(outside)).toEqual([]);
    } finally {
      closeValidatedMusicDir(handle);
    }
  });

  it.each(['..', '.', '../x', 'a/b', '', 'a'.repeat(129)])(
    'rejects unsafe leaf name %s',
    (name) => {
      expect(isSafeLeafName(name)).toBe(false);
    },
  );

  it.each(['abc123.m4a', '.vid123.42.ab12cd.tmp', '.sonic-write-test.1.ff'])(
    'accepts operational leaf name %s',
    (name) => {
      expect(isSafeLeafName(name)).toBe(true);
    },
  );

  it('rejects unsafe leaf names in helper operations', () => {
    ensureLocalMusicDir();
    const handle = openValidatedMusicDir();
    try {
      const source = join(home, 'source.m4a');
      writeFileSync(source, 'song-bytes');

      expect(() =>
        copyFileIntoMusicDir(handle, source, '../escape.tmp'),
      ).toThrow(/unsafe file name/);
      expect(() => renameInMusicDir(handle, 'a.tmp', '../x.m4a')).toThrow(
        /unsafe file names/,
      );
      expect(() => unlinkInMusicDir(handle, '..')).toThrow(/unsafe file name/);
    } finally {
      closeValidatedMusicDir(handle);
    }
  });
});
