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
 *
 * Directory safety: ~/songs itself is validated, not just the song files.
 * Every filesystem operation goes through a validated directory handle
 * (O_NOFOLLOW open pinned by dev+ino). A ~/songs that is a symlink, is not a
 * directory, or does not resolve to the expected location under the home
 * directory is rejected, as is any directory that is swapped out from under
 * an open handle. There is no fallback folder.
 */
import { randomBytes } from 'crypto';
import {
  closeSync,
  constants,
  copyFileSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
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

/**
 * Leaf names allowed inside the music folder for helper-driven operations
 * (temporary files, probes). No separators, so they cannot escape; the exact
 * values '.' and '..' are rejected separately.
 */
const SAFE_LEAF_NAME_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

const MAX_R2_KEY_LENGTH = 1024;

/** Thrown when ~/songs is missing, unsafe, or changes during an operation. */
export class UnsafeMusicDirError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeMusicDirError';
  }
}

/**
 * A validated music directory. The open fd pins the directory object so its
 * identity (dev+ino) cannot be recycled while held; re-lstat the path and
 * compare against it to detect symlink replacement between operations.
 */
export interface ValidatedMusicDir {
  readonly dir: string;
  readonly fd: number;
  readonly dev: number | string;
  readonly ino: number | string;
}

/** Absolute path of the local music folder: ~/songs from the home directory. */
export function getLocalMusicDir(): string {
  return join(homedir(), LOCAL_MUSIC_DIR_NAME);
}

export function isValidYoutubeId(youtubeId: string): boolean {
  return YOUTUBE_ID_PATTERN.test(youtubeId);
}

/** True for a single path segment that cannot traverse out of a directory. */
export function isSafeLeafName(name: string): boolean {
  if (typeof name !== 'string') return false;
  if (name === '.' || name === '..') return false;
  return SAFE_LEAF_NAME_PATTERN.test(name);
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
 * resolved path would escape ~/songs. Pure path math: performs no I/O, and
 * performs no directory validation — callers must operate on the result only
 * through a validated directory handle.
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
 * Open and validate ~/songs, returning a handle that pins it. Rejects a
 * missing path, a symlink (never followed), a non-directory, and any
 * directory that does not resolve to the expected location under the user's
 * home directory. The caller owns the fd and must close it with
 * closeValidatedMusicDir. Throws UnsafeMusicDirError with a clear message.
 */
export function openValidatedMusicDir(): ValidatedMusicDir {
  const dir = getLocalMusicDir();

  let leaf: ReturnType<typeof lstatSync>;
  try {
    leaf = lstatSync(dir);
  } catch (error) {
    throw new UnsafeMusicDirError(
      `Local music folder at ${dir} is missing or cannot be accessed: ${errorDetail(error)}`,
    );
  }
  if (leaf.isSymbolicLink()) {
    throw new UnsafeMusicDirError(
      `Local music folder at ${dir} is a symlink; refusing to follow it. ` +
        `Remove the symlink or point it at a real directory to use local storage.`,
    );
  }
  if (!leaf.isDirectory()) {
    throw new UnsafeMusicDirError(
      `Local music folder at ${dir} is not a directory.`,
    );
  }

  let fd: number;
  try {
    fd = openSync(
      dir,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
  } catch (error) {
    throw new UnsafeMusicDirError(
      `Local music folder at ${dir} cannot be opened as a directory: ${errorDetail(error)}`,
    );
  }

  try {
    const pinned = fstatSync(fd);
    if (!pinned.isDirectory()) {
      throw new UnsafeMusicDirError(
        `Local music folder at ${dir} is not a directory.`,
      );
    }
    if (pinned.dev !== leaf.dev || pinned.ino !== leaf.ino) {
      throw new UnsafeMusicDirError(
        `Local music folder at ${dir} changed while it was being validated.`,
      );
    }

    let realDir: string;
    let realHome: string;
    try {
      realDir = realpathSync(dir);
      realHome = realpathSync(homedir());
    } catch (error) {
      throw new UnsafeMusicDirError(
        `Local music folder at ${dir} cannot be resolved: ${errorDetail(error)}`,
      );
    }
    if (realDir !== join(realHome, LOCAL_MUSIC_DIR_NAME)) {
      throw new UnsafeMusicDirError(
        `Local music folder at ${dir} does not resolve to the expected location under the home directory.`,
      );
    }

    return { dir, fd, dev: pinned.dev, ino: pinned.ino };
  } catch (error) {
    try {
      closeSync(fd);
    } catch {
      // Ignore close errors while propagating the validation failure.
    }
    throw error;
  }
}

/**
 * True when the path still names the same validated directory object the
 * handle pins (same dev+ino, still a real directory, still not a symlink).
 * Detects symlink replacement between operations. Never throws.
 */
export function isMusicDirCurrent(handle: ValidatedMusicDir): boolean {
  try {
    const leaf = lstatSync(handle.dir);
    return (
      !leaf.isSymbolicLink() &&
      leaf.isDirectory() &&
      leaf.dev === handle.dev &&
      leaf.ino === handle.ino
    );
  } catch {
    return false;
  }
}

/** Throw UnsafeMusicDirError unless the handle still names the same directory. */
export function assertMusicDirCurrent(handle: ValidatedMusicDir): void {
  if (!isMusicDirCurrent(handle)) {
    throw new UnsafeMusicDirError(
      `Local music folder at ${handle.dir} is no longer the validated directory; refusing to continue.`,
    );
  }
}

/** Close a validated directory handle. Never throws. */
export function closeValidatedMusicDir(handle: ValidatedMusicDir): void {
  try {
    closeSync(handle.fd);
  } catch {
    // The handle may already be closed; closing is best effort.
  }
}

/**
 * Create ~/songs when missing and validate it, returning its absolute path.
 * Creation is a single non-recursive mkdir, so it can never create through a
 * symlink; an existing symlink is rejected, not followed. Never touches
 * unrelated files. Throws a descriptive Error (UnsafeMusicDirError when the
 * existing path is unsafe).
 */
export function ensureLocalMusicDir(): string {
  const dir = getLocalMusicDir();
  try {
    mkdirSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw new Error(
        `Could not create the local music folder at ${dir}: ${errorDetail(error)}`,
      );
    }
  }

  const handle = openValidatedMusicDir();
  closeValidatedMusicDir(handle);
  return dir;
}

/**
 * Copy a file into the validated music folder under a leaf name, creating it
 * exclusively so an existing entry (including a planted symlink) is never
 * followed or overwritten. Verifies the directory before and after, and that
 * the result is a regular file. Throws on any failure.
 */
export function copyFileIntoMusicDir(
  handle: ValidatedMusicDir,
  sourcePath: string,
  destName: string,
): void {
  if (!isSafeLeafName(destName)) {
    throw new Error(`Refusing to write unsafe file name: ${destName}`);
  }
  assertMusicDirCurrent(handle);
  const destPath = join(handle.dir, destName);
  copyFileSync(sourcePath, destPath, constants.COPYFILE_EXCL);
  assertMusicDirCurrent(handle);

  let created: ReturnType<typeof lstatSync>;
  try {
    created = lstatSync(destPath);
  } catch (error) {
    throw new Error(
      `Local file ${destName} is missing after the copy: ${errorDetail(error)}`,
    );
  }
  if (!created.isFile() || created.isSymbolicLink()) {
    try {
      unlinkSync(destPath);
    } catch {
      // Best effort: report the unsafe result, not the cleanup.
    }
    throw new UnsafeMusicDirError(
      `Local file ${destName} is not a regular file after the copy; refusing to use it.`,
    );
  }
}

/**
 * Atomically rename one leaf to another inside the validated music folder.
 * Both names must be single safe segments, so neither side can escape the
 * directory. Verifies the directory before and after, and that the final
 * entry is a regular file. Throws on any failure.
 */
export function renameInMusicDir(
  handle: ValidatedMusicDir,
  fromName: string,
  toName: string,
): void {
  if (!isSafeLeafName(fromName) || !isSafeLeafName(toName)) {
    throw new Error(
      `Refusing to rename unsafe file names: ${fromName} -> ${toName}`,
    );
  }
  assertMusicDirCurrent(handle);
  const fromPath = join(handle.dir, fromName);
  const toPath = join(handle.dir, toName);
  renameSync(fromPath, toPath);
  assertMusicDirCurrent(handle);

  let renamed: ReturnType<typeof lstatSync>;
  try {
    renamed = lstatSync(toPath);
  } catch (error) {
    throw new Error(
      `Local file ${toName} is missing after the rename: ${errorDetail(error)}`,
    );
  }
  if (!renamed.isFile() || renamed.isSymbolicLink()) {
    try {
      unlinkSync(toPath);
    } catch {
      // Best effort: report the unsafe result, not the cleanup.
    }
    throw new UnsafeMusicDirError(
      `Local file ${toName} is not a regular file after the rename; refusing to use it.`,
    );
  }
}

/**
 * Delete one leaf inside the validated directory. unlink never follows
 * symlinks. Throws on failure; callers doing best-effort cleanup catch it.
 */
export function unlinkInMusicDir(
  handle: ValidatedMusicDir,
  name: string,
): void {
  if (!isSafeLeafName(name)) {
    throw new Error(`Refusing to delete unsafe file name: ${name}`);
  }
  assertMusicDirCurrent(handle);
  unlinkSync(join(handle.dir, name));
}

/**
 * True when the r2_key names a regular local file inside the validated music
 * folder. A missing, symlinked, swapped, or otherwise unsafe music folder,
 * and any symlink, directory, or out-of-folder file, report false.
 * Never throws.
 */
export function localSongFileExists(r2Key: string): boolean {
  const filePath = getLocalSongPathFromR2Key(r2Key);
  if (!filePath) return false;

  let handle: ValidatedMusicDir;
  try {
    handle = openValidatedMusicDir();
  } catch {
    return false;
  }
  try {
    let stats: ReturnType<typeof lstatSync>;
    try {
      stats = lstatSync(filePath);
    } catch {
      return false;
    }
    if (!stats.isFile() || stats.isSymbolicLink()) return false;
    return isMusicDirCurrent(handle);
  } finally {
    closeValidatedMusicDir(handle);
  }
}

function errorDetail(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

/**
 * Create ~/songs and verify write, read, and delete with a unique probe file
 * that is removed afterwards. The music folder itself is validated (never a
 * followed symlink) and re-checked across every probe step. Throws a
 * descriptive Error on any failure. There is no fallback folder: callers must
 * fail the operation instead.
 */
export function verifyLocalMusicDir(): { dir: string } {
  let dir: string;
  try {
    dir = ensureLocalMusicDir();
  } catch (error) {
    throw new Error(
      `Local storage setup failed: the music folder at ${getLocalMusicDir()} cannot be used: ${errorDetail(error)}`,
    );
  }

  let handle: ValidatedMusicDir;
  try {
    handle = openValidatedMusicDir();
  } catch (error) {
    throw new Error(
      `Local storage setup failed: the music folder at ${dir} cannot be used: ${errorDetail(error)}`,
    );
  }

  const probeName = `.sonic-write-test.${process.pid}.${randomBytes(6).toString('hex')}`;
  const probePath = join(dir, probeName);
  const probeContents = `sonic-write-test ${randomBytes(16).toString('hex')}`;
  try {
    assertMusicDirCurrent(handle);
    writeFileSync(probePath, probeContents, { flag: 'wx', mode: 0o600 });
    assertMusicDirCurrent(handle);
    const readBack = readFileSync(probePath, 'utf8');
    if (readBack !== probeContents) {
      throw new Error('read-back contents did not match what was written');
    }
    assertMusicDirCurrent(handle);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('Local storage setup failed')
    ) {
      throw error;
    }
    throw new Error(
      `Local storage setup failed: the music folder at ${dir} failed the write/read/delete check: ${errorDetail(error)}`,
    );
  } finally {
    try {
      if (isMusicDirCurrent(handle)) {
        unlinkSync(probePath);
      }
    } catch {
      // Best effort: a leftover probe file is harmless and uniquely named.
    }
    closeValidatedMusicDir(handle);
  }

  return { dir };
}
