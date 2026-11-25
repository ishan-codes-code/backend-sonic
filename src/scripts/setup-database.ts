import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';
import { resolve } from 'path';
import {
  reloadRuntimeConfig,
  saveRuntimeConfig,
} from '../infrastructure/config/runtime-config';

const VALIDATION_TIMEOUT_MS = 20_000;

function cleanDatabaseUrl(input: string): string {
  let value = input.trim();
  const psqlPrefix = /^psql\s+/.exec(value);
  if (psqlPrefix) {
    value = value.slice(psqlPrefix[0].length).trim();
  } else if (value === 'psql') {
    value = '';
  }
  if (value.length >= 2) {
    const first = value.charAt(0);
    const last = value.charAt(value.length - 1);
    if ((first === '"' || first === "'" || first === '`') && first === last) {
      value = value.slice(1, -1).trim();
    }
  }
  return value;
}

function isPostgresUrl(value: string): boolean {
  return /^postgres(ql)?:\/\//.test(value);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

function redactSecrets(text: string): string {
  return text.replace(/(postgres(?:ql)?:\/\/[^/\s@]+:)[^@\s/]*@/g, '$1***@');
}

function isConfigured(): boolean {
  if (process.env.DATABASE_URL) return true;
  try {
    return Boolean(reloadRuntimeConfig({ readOnly: true }).DATABASE_URL);
  } catch {
    return false;
  }
}

async function validateConnection(databaseUrl: string): Promise<void> {
  const sql = neon(databaseUrl);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      sql`select 1`,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Database validation timed out')),
          VALIDATION_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function runMigrations(databaseUrl: string): Promise<void> {
  const sql = neon(databaseUrl);
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
}

async function main(): Promise<void> {
  if (process.argv.slice(2).includes('--check')) {
    process.exit(isConfigured() ? 0 : 1);
  }

  const raw = process.env.SETUP_DATABASE_URL;
  if (!raw || !raw.trim()) {
    console.error(
      'SETUP_DATABASE_URL is not set. Paste your Neon database URL when prompted.',
    );
    process.exit(1);
  }
  const databaseUrl = cleanDatabaseUrl(raw);
  if (!databaseUrl || !isPostgresUrl(databaseUrl)) {
    console.error(
      'Invalid database URL: expected a value starting with postgres:// or postgresql://.',
    );
    process.exit(1);
  }

  try {
    await validateConnection(databaseUrl);
  } catch (error) {
    console.error(
      `Database connection failed: ${redactSecrets(errorMessage(error))}`,
    );
    process.exit(1);
  }

  try {
    await runMigrations(databaseUrl);
  } catch (error) {
    console.error(
      `Database migrations failed: ${redactSecrets(errorMessage(error))}`,
    );
    process.exit(1);
  }

  saveRuntimeConfig({ DATABASE_URL: databaseUrl });
  console.log('Database configured: connection validated and tables created.');
}

main().catch((error: unknown) => {
  console.error(redactSecrets(errorMessage(error)));
  process.exit(1);
});
