/**
 * Setup completeness helpers shared by the API health and setup endpoints.
 *
 * Setup is required while ANY of these values is missing or blank. The mobile
 * app supplies every key except DATABASE_URL through POST /setup/config;
 * DATABASE_URL is entered in the Termux installer.
 */
export const SETUP_REQUIRED_KEYS = [
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

/** True when at least one required setup value is missing or blank. */
export function isSetupRequired(values: SetupConfigValues): boolean {
  return SETUP_REQUIRED_KEYS.some((key) =>
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
