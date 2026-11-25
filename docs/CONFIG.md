# Runtime configuration

The API and worker share `data/config.json` (or the file selected by
`CONFIG_PATH`, relative to the process working directory). Configuration uses
this precedence:

1. Process environment variables, including values loaded from an existing `.env` file.
2. `data/config.json`.
3. Built-in defaults.

The API writes config updates atomically while holding an exclusive lock.
Config and setup-token hash files are mode `0600`. The API alone generates
missing JWT access, JWT refresh, and worker secrets; the worker never generates
secrets. If a key is set in the environment, that value wins and the key is
reported as environment-locked by the setup status endpoint. The app cannot
change environment-locked values.

Config file keys use the same names as environment variables, for example:

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
`YOUTUBE_API_KEY`, `YOUTUBE_API_KEY_DEV`, `YOUTUBE_API_KEY_BACKUP`,
`YOUTUBE_API_KEY_PROD`, `WORKER_URL`, `WORKER_SECRET`,
`WORKER_STREAM_SECRET`, `WORKER_STREAM_URL`, `API_CORS_ORIGIN`,
`CLOUDFLARE_ACCOUNT_ID`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`,
`R2_BUCKET`, `LASTFM_API_KEY`, `YTDLP_COOKIES_PATH`, `USE_WS_DB`, and
`NODE_ENV`.

The worker keys are `WORKER_PORT`, `DATABASE_URL`, `WORKER_SECRET`,
`WORKER_CORS_ORIGIN`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`, and
`R2_BUCKET`.

## Setup flow

On first API boot, a high-entropy setup token is printed once and only its
SHA-256 hash is stored under the config directory. Keep the token; the API does
not reveal it again. `GET /setup/status` and `POST /setup/config` require it in
`X-Setup-Token`, are rate-limited, and never return secret values. Status
reports per-key configuration booleans and environment-locked keys.

`POST /setup/config` accepts whitelisted string keys. A supplied
`DATABASE_URL` must pass `select 1`; database migrations then run before values
are saved. The API responds with migration status and exits cleanly after the
response. Run it under `scripts/run.sh` or the Termux installer so it is
restarted automatically. Setup-token authorization remains available for later
edits; protect the token as an administrator credential.

Updating either JWT secret invalidates existing JWTs. Updating `WORKER_SECRET`
is read by the worker without a restart; the API restarts after config saves.
Worker changes that affect its initialized dependencies cause a worker restart.
Hosts with ephemeral filesystems (including Render) should provide secrets as
environment variables so they survive restarts.

## Termux install

In Termux, run:

```sh
curl -fsSL https://raw.githubusercontent.com/ishan-codes-code/backend-sonic/release/v4/scripts/install-termux.sh | bash
```

The installer installs dependencies, builds, then supervises the API and
worker. The worker uses its in-memory queue and waits for database connectivity;
no separate queue service is required. Use the printed LAN URL and one-time
setup token in the mobile app. Install the Termux:Boot Android app and rerun the
installer to configure startup after device reboot. Termux may require
disabling battery optimization for reliable background operation.

## Health endpoint

`GET /health` is public and excluded from throttling. It always responds with
HTTP 200 and reports the application/version contract, whether database setup
is required, a database probe state (`ok`, `down`, or `unconfigured`), and
whether all R2 storage credentials are present (`r2` or `none`). The database
probe runs `select 1` with a two-second timeout. The response contains no
secrets, URLs, or keys.
