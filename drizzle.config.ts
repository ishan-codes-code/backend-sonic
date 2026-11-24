import { defineConfig } from 'drizzle-kit';
import { loadRuntimeConfig } from './src/infrastructure/config/runtime-config';

const databaseUrl = loadRuntimeConfig({ readOnly: true }).DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is missing');
}

export default defineConfig({
  schema: './src/infrastructure/database/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
});
