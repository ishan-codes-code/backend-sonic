export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  database: {
    url: process.env.DATABASE_URL,
  },
  redis: {
    url: process.env.REDIS_URL,
  },
  queue: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
  r2: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    accessKey: process.env.R2_ACCESS_KEY,
    secretKey: process.env.R2_SECRET_KEY,
    bucket: process.env.R2_BUCKET,
  },
  lastfm: {
    apiKey: process.env.LASTFM_API_KEY,
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'super-secret-access',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'super-secret-refresh',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },
});
