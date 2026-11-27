import { loadRuntimeConfig } from './runtime-config';

export default () => {
  const runtime = loadRuntimeConfig();
  return {
    ...runtime,
    port: parseInt(runtime.PORT || '3000', 10),
    database: {
      url: runtime.DATABASE_URL,
    },
    r2: {
      accountId: runtime.R2_ACCOUNT_ID ?? runtime.CLOUDFLARE_ACCOUNT_ID,
      accessKey: runtime.R2_ACCESS_KEY,
      secretKey: runtime.R2_SECRET_KEY,
      bucket: runtime.R2_BUCKET,
    },
    storage: {
      // Effective mode shared by the API and worker. Missing, blank, or
      // invalid values behave as "r2"; an invalid value additionally keeps
      // setup required (see setup-requirements) until it is fixed.
      mode: runtime.STORAGE_MODE === 'local' ? 'local' : 'r2',
    },
    lastfm: {
      apiKey: runtime.LASTFM_API_KEY,
    },
    jwt: {
      accessSecret: runtime.JWT_ACCESS_SECRET,
      refreshSecret: runtime.JWT_REFRESH_SECRET,
      accessExpiresIn: runtime.JWT_ACCESS_EXPIRES_IN || '15m',
      refreshExpiresIn: runtime.JWT_REFRESH_EXPIRES_IN || '30d',
    },
    worker: {
      secret: runtime.WORKER_SECRET,
      streamSecret: runtime.WORKER_STREAM_SECRET,
      streamUrl: runtime.WORKER_STREAM_URL,
      url: runtime.WORKER_URL,
    },
  };
};
