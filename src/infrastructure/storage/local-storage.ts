/**
 * Local storage mode helpers.
 *
 * Local mode keeps the database schema and the existing r2_key format
 * `songs/<youtubeId>.m4a`. The local path is the home directory joined with
 * the r2_key, giving `~/songs/<youtubeId>.m4a`. No extra "songs" folder is
 * added, no R2 objects are renamed, and no migration is required.
 *
 * Only the expected `songs/<youtubeId>.m4a` format is ever resolved, and only
 * files inside ~/songs are ever served. Nothing else in the home directory is
 * touched: ~/songs may already exist and unrelated files there are left alone.
 */
import { randomBytes } from 'crypto';
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { homedir } from 'os';
import { join, resolve, sep } from 'path';

export const LOCAL_MUSIC_DIR_NAME = 'songs';
export const LOCAL_R2_KEY_PREFIX = 'songs/';
export const LOCAL_AUDIO_EXTENSION = '.m4a';

/**
 * YouTube video IDs are 11 URL-safe characters; accept 1-64 so tests and
 * edge cases keep working while path separators, dots, and every other
 * traversal character stay rejected.
 */
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const MAX_R2_KEY_LENGTH = 1024;

/** Absolute path of the local music folder: ~/songs from the home directory. */
export function getLocalMusicDir(): string {
  return join(homedir(), LOCAL_MUSIC_DIR_NAME);
}

export function isValidYoutubeId(youtubeId: string): boolean {
  return YOUTUBE_ID_PATTERN.test(youtubeId);
}

/**
 * Parse an r2_key of the exact expected `songs/<youtubeId>.m4a` form.
 * Returns the youtubeId, or null for anything else. Never throws.
 */
export function parseLocalR2Key(r2Key: string): string | null {
  if (typeof r2Key !== 'string') return null;
  if (r2Key.length === 0 || r2Key.length > MAX_R2_KEY_LENGTH) return null;
  if (!r2Key.startsWith(LOCAL_R2_KEY_PREFIX)) return null;
  if (!r2Key.endsWith(LOCAL_AUDIO_EXTENSION)) return null;
  const youtubeId = r2Key.slice(
    LOCAL_R2_KEY_PREFIX.length,
    r2Key.length - LOCAL_AUDIO_EXTENSION.length,
  );
  if (!isValidYoutubeId(youtubeId)) return null;
  return youtubeId;
}

/** Build the r2_key for a validated youtubeId. Returns null when invalid. */
export function buildLocalR2Key(youtubeId: string): string | null {
  if (!isValidYoutubeId(youtubeId)) return null;
  return `${LOCAL_R2_KEY_PREFIX}${youtubeId}${LOCAL_AUDIO_EXTENSION}`;
}

/** True when `target` resolves strictly inside `dir` (or equals a file in it). */
export function isPathInsideDir(dir: string, target: string): boolean {
  const resolvedDir = resolve(dir);
  const resolvedTarget = resolve(resolvedDir, target);
  const withSep = resolvedDir.endsWith(sep)
    ? resolvedDir
    : `${resolvedDir}${sep}`;
  return (
    resolvedTarget.startsWith(withSep) && resolvedTarget.length > withSep.length
  );
}

/**
 * Absolute local path for a youtubeId, or null when the ID is invalid or the
 * resolved path would escape ~/songs. Pure path math: performs no I/O.
 */
export function getLocalSongPath(youtubeId: string): string | null {
  if (!isValidYoutubeId(youtubeId)) return null;
  const dir = getLocalMusicDir();
  const candidate = join(dir, `${youtubeId}${LOCAL_AUDIO_EXTENSION}`);
  if (!isPathInsideDir(dir, candidate)) return null;
  return candidate;
}

/**
 * Absolute local path for an r2_key, or null unless the key has the exact
 * expected `songs/<youtubeId>.m4a` form and resolves inside ~/songs.
 */
export function getLocalSongPathFromR2Key(r2Key: string): string | null {
  const youtubeId = parseLocalR2Key(r2Key);
  if (!youtubeId) return null;
  return getLocalSongPath(youtubeId);
}

/**
 * True when the r2_key names a regular local file. Symlinks, directories,
 * and anything outside ~/songs report false. Never throws.
 */
export function localSongFileExists(r2Key: string): boolean {
  const filePath = getLocalSongPathFromR2Key(r2Key);
  if (!filePath) return false;
  try {
    const stats = lstatSync(filePath);
    return stats.isFile() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Create ~/songs when missing (recursive, no-op when present) and return its
 * absolute path. Never touches unrelated files.
 */
export function ensureLocalMusicDir(): string {
  const dir = getLocalMusicDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

function errorDetail(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

/**
 * Create ~/songs and verify write, read, and delete with a unique probe file
 * that is removed afterwards. Throws a descriptive Error on any failure.
 * There is no fallback folder: callers must fail the operation instead.
 */
export function verifyLocalMusicDir(): { dir: string } {
  const dir = getLocalMusicDir();
  try {
    mkdirSync(dir, { recursive: true });
  } catch (error) {
    throw new Error(
      `Local storage setup failed: could not create the music folder at ${dir}: ${errorDetail(error)}`,
    );
  }

  try {
    if (!statSync(dir).isDirectory()) {
      throw new Error(`Local storage setup failed: ${dir} is not a directory.`);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('Local storage setup failed')
    ) {
      throw error;
    }
    throw new Error(
      `Local storage setup failed: could not stat the music folder at ${dir}: ${errorDetail(error)}`,
    );
  }

  const probeName = `.sonic-write-test.${process.pid}.${randomBytes(6).toString('hex')}`;
  const probePath = join(dir, probeName);
  const probeContents = `sonic-write-test ${randomBytes(16).toString('hex')}`;
  try {
    writeFileSync(probePath, probeContents, { flag: 'wx', mode: 0o600 });
    const readBack = readFileSync(probePath, 'utf8');
    if (readBack !== probeContents) {
      throw new Error('read-back contents did not match what was written');
    }
  } catch (error) {
    throw new Error(
      `Local storage setup failed: the music folder at ${dir} failed the write/read/delete check: ${errorDetail(error)}`,
    );
  } finally {
    try {
      unlinkSync(probePath);
    } catch {
      // Best effort: a leftover probe file is harmless and uniquely named.
    }
  }

  return { dir };
}
