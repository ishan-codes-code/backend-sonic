import { readFileSync } from 'fs';
import { resolve } from 'path';

// Bump API_VERSION on any breaking API change; raise MIN_APP_VERSION when old apps can no longer talk to this backend.
export const API_VERSION = 1;
export const MIN_APP_VERSION = '4.0.0';

export function getPackageVersion(): string {
  try {
    return (
      JSON.parse(
        readFileSync(resolve(__dirname, '../../package.json'), 'utf8'),
      ) as { version: string }
    ).version;
  } catch {
    return 'unknown';
  }
}
