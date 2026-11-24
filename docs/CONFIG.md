# Runtime configuration

The API and worker load configuration in this order:

1. Process environment variables (including values loaded from the existing `.env` file).
2. The JSON file selected by `CONFIG_PATH`.
3. Built-in defaults.

`CONFIG_PATH` is an environment variable used to select the file; it defaults to
`./data/config.json`, relative to the process working directory. Config file
keys use the same names as environment variables, for example:

```json
{
  "DATABASE_URL": "postgresql://...",
  "PORT": "3000",
  "R2_ACCOUNT_ID": "account-id",
  "R2_ACCESS_KEY": "access-key",
  "R2_SECRET_KEY": "secret-key",
  "R2_BUCKET": "bucket-name"
}
```

The API keys are `PORT`, `DATABASE_URL`, `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`,
`YOUTUBE_API_KEY`, `WORKER_URL`, `WORKER_SECRET`, `WORKER_STREAM_SECRET`,
`WORKER_STREAM_URL`, and `API_CORS_ORIGIN`.

The worker keys are `WORKER_PORT`, `DATABASE_URL`, `WORKER_SECRET`,
`WORKER_CORS_ORIGIN`, `REDIS_HOST`, `REDIS_PORT`, `R2_ACCOUNT_ID`,
`R2_ACCESS_KEY`, `R2_SECRET_KEY`, and `R2_BUCKET`. Other optional application
keys include `REDIS_URL`, `USE_WS_DB`, `YOUTUBE_API_KEY_DEV`,
`YOUTUBE_API_KEY_BACKUP`, `YOUTUBE_API_KEY_PROD`, `LASTFM_API_KEY`,
`YTDLP_COOKIES_PATH`, and `NODE_ENV`.

When `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, or `WORKER_SECRET` is absent
from both the process environment and config file, a random secret is generated
and persisted in the config file with mode `0600` if it can be written. Secrets
are never returned by health checks or logged.

## Health endpoint

`GET /health` is public and excluded from throttling. It always responds with
HTTP 200 and reports the application/version contract, whether database setup
is required, a database probe state (`ok`, `down`, or `unconfigured`), and
whether all R2 storage credentials are present (`r2` or `none`). The database
probe runs `select 1` with a two-second timeout. The response contains no
secrets, URLs, or keys.
