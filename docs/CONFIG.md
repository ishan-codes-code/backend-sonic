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

The API keys are `PORT`, `DATABASE_URL`, `STORAGE_MODE`,
`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRES_IN`,
`JWT_REFRESH_EXPIRES_IN`, `JWT_PLAYBACK_SECRET`, `YOUTUBE_API_KEY`,
`YOUTUBE_API_KEY_DEV`, `YOUTUBE_API_KEY_BACKUP`, `YOUTUBE_API_KEY_PROD`,
`WORKER_URL`, `WORKER_SECRET`, `WORKER_STREAM_SECRET`, `WORKER_STREAM_URL`,
`API_CORS_ORIGIN`, `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY`,
`R2_SECRET_KEY`, `R2_BUCKET`, `LASTFM_API_KEY`, `YTDLP_COOKIES_PATH`,
`USE_WS_DB`, and `NODE_ENV`.

`STORAGE_MODE` is `"local"` or `"r2"`, settable through `POST /setup/config`
or as an environment override like any other key. A missing or blank value
means `"r2"`; any other value is rejected by setup (and, when it arrives via
the environment, keeps setup required until fixed).

Setup is complete only when every mode-required key is set and non-blank.
In `r2` mode: `DATABASE_URL`, `R2_ACCOUNT_ID` (or legacy
`CLOUDFLARE_ACCOUNT_ID`), `R2_ACCESS_KEY`, `R2_SECRET_KEY`, `R2_BUCKET`,
`WORKER_STREAM_URL`, `JWT_PLAYBACK_SECRET`, `YOUTUBE_API_KEY`, and
`LASTFM_API_KEY`. A trailing slash on `WORKER_STREAM_URL` is stripped when
the config loads, so stream URLs never contain `//`. In `local` mode only
`DATABASE_URL`, `YOUTUBE_API_KEY`, and `LASTFM_API_KEY` are required: no R2
keys, no `WORKER_STREAM_URL`, and no user-provided playback secret. When a
local setup is saved and no playback secret exists anywhere (environment,
request, or stored file), the API generates one and persists it alongside the
other values; an existing secret is never replaced, and restarts keep the
saved value.

The worker keys are `WORKER_PORT`, `DATABASE_URL`, `STORAGE_MODE`,
`WORKER_SECRET`, `WORKER_CORS_ORIGIN`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY`,
`R2_SECRET_KEY`, and `R2_BUCKET`. Both the API and the worker use the saved
mode after setup: the API restarts after every config save, and the worker
restarts (under the supervisor) whenever any saved key except `WORKER_SECRET`
changes, which includes `STORAGE_MODE`.

## Local storage mode

Local mode stores audio in `~/songs`, resolved from the process home
directory. The database schema and the `songs/<youtubeId>.m4a` key format are
unchanged; the local path is the home directory joined with the key, giving
`~/songs/<youtubeId>.m4a`. Only that exact form is ever resolved, and only
files inside `~/songs` are ever served; nothing else in the home directory is
touched, and an already-existing `~/songs` keeps its unrelated files.
`~/songs` itself must be a real directory at the expected location: a symlink
is rejected rather than followed, and any operation that finds the folder
missing, swapped, or otherwise unsafe fails instead of falling back.

Saving a local setup first creates `~/songs` and verifies write, read, and
delete with a probe file that is removed afterwards; the save fails with a
clear error when the folder cannot be used, and there is no fallback folder.
Downloads keep the existing download, duration, and faststart steps, then the
finished file is copied to a temporary file inside `~/songs` and atomically
renamed to its final name; the song is marked ready only after the rename,
temporary files are cleaned up on failure, and local mode makes no R2 calls.

A database row alone never means a local song is ready. When a file is
missing, every play path (direct play, metadata play, playlist tracks, and
job status) starts a new download instead of returning a broken URL:
single-song paths return a `job` response, job status returns `active`, and
playlist tracks are returned with an empty `streamUrl` plus the `jobId` to
poll.

Changing `STORAGE_MODE` on an already configured server is allowed but
performs no migration and no data movement: content available under the new
mode keeps working, and anything missing under local mode is re-downloaded on
demand. There is no storage switching UI, song migration, phone storage, or
web page in scope.

## Local streaming endpoint

In local mode the API serves audio itself at `GET /stream/<youtubeId>` (HEAD
is supported too). Requests authenticate with
`Authorization: Bearer <playback token>`; the API verifies the signature
against `JWT_PLAYBACK_SECRET`, the expiry, and scope `"stream"`, and rejects
login tokens. Tokens are never logged. Full responses are `200`, single-range
responses are `206`, unsatisfiable ranges are `416` with
`Content-Range: bytes */<size>`, and missing files are `404`. Audio headers
(`Content-Type: audio/mp4`, `Accept-Ranges: bytes`, `Content-Length`, and
`Content-Range` for ranges) are set, and bytes stream from disk without
loading the whole file into memory. IDs are validated, path and symlink
escapes are rejected, and the endpoint answers `404` in `r2` mode.

Play responses embed `<API base>/stream/<youtubeId>`. The base is derived per
request from the request the phone used to reach the API: the host comes from
the first `X-Forwarded-Host` entry when present, else the `Host` header, and
is strictly validated (hostname/IP with optional port only, no credentials or
paths); the scheme comes from `X-Forwarded-Proto` when it is exactly
`http`/`https` (how proxies and tunnels report the outer HTTPS connection),
else the direct connection protocol. Localhost is never assumed: it appears
only when the client itself used it. This cannot redirect one client's token
elsewhere, because each derived URL is returned only to the requester that
supplied those headers and absolute local stream URLs are never cached or
shared across requests (the playlist and stream-URL caches hold metadata
only).

## Setup flow

On first API boot, a high-entropy setup token is printed once and only its
SHA-256 hash is stored under the config directory. Keep the token; the API does
not reveal it again. `GET /setup/status` and `POST /setup/config` require it in
`X-Setup-Token`, are rate-limited, and never return secret values. Status
reports per-key configuration booleans and environment-locked keys.

`POST /setup/config` accepts whitelisted string keys. The mobile app sends
all mode-required keys except `DATABASE_URL` (which the Termux installer
already stored) in one request, leaving out environment-locked keys: in `r2`
mode that is `STORAGE_MODE` (optional, defaults to `"r2"`), the R2 keys,
`WORKER_STREAM_URL`, `JWT_PLAYBACK_SECRET`, `YOUTUBE_API_KEY`, and
`LASTFM_API_KEY`; in `local` mode it is `STORAGE_MODE: "local"` plus
`YOUTUBE_API_KEY` and `LASTFM_API_KEY` (`JWT_PLAYBACK_SECRET` may be supplied
but is generated when omitted). A supplied `DATABASE_URL` must pass
`select 1`; database migrations then run before values are saved. The API
responds with migration status, the effective `storageMode`, and
`generatedKeys` (secret names only, never values), then exits cleanly after
the response. Run it under `scripts/run.sh` or the Termux installer so it is
restarted automatically. Setup-token authorization remains available for later
edits; protect the token as an administrator credential. `GET /setup/status`
additionally reports `storageModes: ["local", "r2"]`, the modes this backend
supports; older backends omit the field, which the app must treat as
`"r2" only`.

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
setup token in the mobile app. If setup is incomplete and no token is printed,
rerun the installer with `--reconfigure` to generate a new token (it also
re-prompts for the database URL). Install the Termux:Boot Android app and rerun
the installer to configure startup after device reboot. Termux may require
disabling battery optimization for reliable background operation.

## Health endpoint

`GET /health` is public and excluded from throttling. It always responds with
HTTP 200 and reports the application/version contract, whether setup is
required (any mode-required key missing or blank, or an invalid
`STORAGE_MODE`), a database probe state (`ok`, `down`, or `unconfigured`,
reported separately from setup completeness), the effective storage backend
(`local`, `r2` when all R2 credentials are present, else `none`), and
`storageModes: ["local", "r2"]`, the modes this backend supports. The app
detects local-storage support through `features.storageModes` and must reject
backends where the field is missing (older backends predate local mode) when
the user selects local storage. The database probe runs `select 1` with a
six-second timeout. The response contains no secrets, URLs, or keys.
