/**
 * Setup completeness helpers shared by the API health and setup endpoints.
 *
 * Setup is required while ANY mode-required value is missing or blank. The
 * mobile app supplies every key except DATABASE_URL through POST
 * /setup/config; DATABASE_URL is entered in the Termux installer.
 *
 * STORAGE_MODE selects the backend: "local" serves audio files from
 * ~/songs on the API host, "r2" uses Cloudflare R2. A missing or blank
 * STORAGE_MODE means "r2". Any other value keeps setup required until fixed.
 */
export const STORAGE_MODES = ['local', 'r2'] as const;

export type StorageMode = (typeof STORAGE_MODES)[number];

export const R2_SETUP_REQUIRED_KEYS = [
  'DATABASE_URL',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY',
  'R2_SECRET_KEY',
  'R2_BUCKET',
  'WORKER_STREAM_URL',
  'JWT_PLAYBACK_SECRET',
  'YOUTUBE_API_KEY',
  'LASTFM_API_KEY',
] as const;

/** Local mode needs no R2 keys, no worker stream URL, and no user-provided
 * playback secret (the API generates and persists one during setup). */
export const LOCAL_SETUP_REQUIRED_KEYS = [
  'DATABASE_URL',
  'YOUTUBE_API_KEY',
  'LASTFM_API_KEY',
] as const;

/** Backwards-compatible alias: the default (r2) required keys. */
export const SETUP_REQUIRED_KEYS = R2_SETUP_REQUIRED_KEYS;

export type SetupRequiredKey = (typeof SETUP_REQUIRED_KEYS)[number];

export type SetupConfigValues = Record<string, string | undefined>;

export function isValueMissing(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}

/**
 * Effective R2 account ID, keeping the legacy CLOUDFLARE_ACCOUNT_ID fallback.
 */
export function getEffectiveAccountId(
  values: SetupConfigValues,
): string | undefined {
  if (!isValueMissing(values.R2_ACCOUNT_ID)) return values.R2_ACCOUNT_ID;
  return values.CLOUDFLARE_ACCOUNT_ID;
}

function getEffectiveValue(
  values: SetupConfigValues,
  key: string,
): string | undefined {
  if (key === 'R2_ACCOUNT_ID') return getEffectiveAccountId(values);
  return values[key];
}

/**
 * Effective storage mode. Missing or blank means "r2". Returns undefined for
 * any other value, which keeps setup required until the value is fixed.
 */
export function getStorageMode(
  values: SetupConfigValues,
): StorageMode | undefined {
  const raw = values.STORAGE_MODE;
  if (isValueMissing(raw)) return 'r2';
  if (raw === 'local' || raw === 'r2') return raw;
  return undefined;
}

/** Required setup keys for an effective storage mode. */
export function getRequiredKeysForMode(mode: StorageMode): readonly string[] {
  return mode === 'local' ? LOCAL_SETUP_REQUIRED_KEYS : R2_SETUP_REQUIRED_KEYS;
}

/** True when at least one required setup value is missing or blank. */
export function isSetupRequired(values: SetupConfigValues): boolean {
  const mode = getStorageMode(values);
  if (!mode) return true;
  return getRequiredKeysForMode(mode).some((key) =>
    isValueMissing(getEffectiveValue(values, key)),
  );
}

/** True when a config key counts as configured (fallback-aware for R2_ACCOUNT_ID). */
export function isKeyConfigured(
  values: SetupConfigValues,
  key: string,
): boolean {
  return !isValueMissing(getEffectiveValue(values, key));
}

/** Remove trailing slashes so stream URLs never contain "//". */
export function stripTrailingSlash(
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  return value.replace(/\/+$/, '');
}
