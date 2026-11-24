import { loadRuntimeConfig } from './runtime-config';

export default () => {
  const runtime = loadRuntimeConfig();
  return {
    ...runtime,
    port: parseInt(runtime.PORT || '3000', 10),
    database: {
      url: runtime.DATABASE_URL,
    },
    redis: {
      url: runtime.REDIS_URL,
    },
    queue: {
      host: runtime.REDIS_HOST || '127.0.0.1',
      port: parseInt(runtime.REDIS_PORT || '6379', 10),
    },
    r2: {
      accountId: runtime.R2_ACCOUNT_ID ?? runtime.CLOUDFLARE_ACCOUNT_ID,
      accessKey: runtime.R2_ACCESS_KEY,
      secretKey: runtime.R2_SECRET_KEY,
      bucket: runtime.R2_BUCKET,
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
