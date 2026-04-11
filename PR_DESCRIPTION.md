# Sonic Backend PR Description

> Maintenance rule: update this file before every `git push` whenever routes, workflows, schema, dependencies, or operational assumptions change. This file is intended to be the current single source of truth for agents and developers working in this repository.

## Project Overview

Sonic Backend is a modern NestJS API designed for high-performance music streaming, ingestion, and library management. It follows an asynchronous, job-based architecture for media processing and uses a global deduplicated song catalog.

The system supports:
- **Unified Playback**: A single `/songs/play` endpoint that resolves songs from various sources (global catalog, direct IDs, or YouTube).
- **Intelligent Ingestion**: Background workers handle audio downloading (`yt-dlp`), normalization/conversion (`ffmpeg`), and secure storage (Cloudflare R2).
- **Discovery Engine**: Genre-based track discovery and similar-song recommendations powered by Last.fm tags and metrics.
- **Library & Playlists**: Structured user library with automated "Favorites" system and dynamic mosaic thumbnails.

## Purpose

The system balances shared storage efficiency with personal user experiences. Each song is stored once globally based on its unique YouTube ID. Users maintain their own "views" of this catalog via libraries and ordered playlists without duplicating media files.

## Runtime Architecture

### Stack

- **Framework**: NestJS 11 (Modular Architecture)
- **Language**: TypeScript
- **Database**: Neon Postgres (Serverless)
- **ORM**: Drizzle ORM (with Drizzle Kit for migrations)
- **Storage**: Cloudflare R2 (S3-compatible via AWS SDK)
- **Queue**: BullMQ with IORedis (for background processing)
- **Authentication**: JWT (Access & Refresh tokens with session persistence)
- **Media**: `yt-dlp-wrap` for downloads, `ffmpeg-static` for audio processing
- **Discovery**: Last.fm API (v2.0)

### Boot Flow

The application runs as two distinct processes:

1. **API Server**: Entry point in [src/apps/api/main.ts](/src/apps/api/main.ts). Handles HTTP traffic, authentication, and validation.
2. **Background Worker**: Entry point in [src/apps/worker/main.ts](/src/apps/worker/main.ts). Consumes "play-song" jobs from BullMQ to prepare media.

### Module Layout

- **`ApiModule`**: Core composition in [src/apps/api/api.module.ts](/src/apps/api/api.module.ts). Orchestrates global modules (Config, Throttler, Database, R2) and feature modules (Auth, Songs, Playlist, Search, Recommendation, Discovery).
- **`WorkerModule`**: Composition in [src/apps/worker/worker.module.ts](/src/apps/worker/worker.module.ts). Houses the `SongProcessor` logic.

## Data Model

Schema lives in [src/infrastructure/database/schema.ts](/src/infrastructure/database/schema.ts).

### Core Tables

- **`users`**: Profile management with `favoritesPlaylistId` to link user to their system favorites.
- **`sessions`**: Durable session tracking linked to refresh token hashes.
- **`songs`**: Unified global catalog.
  - Key fields: `youtubeId` (unique), `r2Key`, `normalizedTitle`, `normalizedArtist`, `lastfmId`.
- **`playlist`**: User-owned song collections.
  - Supports `isSystem` (for Favorites, etc.), `isPublic`, and `thumbnailUrl` (string array of covers).
- **`playlist_songs`**: Junction table with a mandatory `position` field for sequencing.

## Source Structure

- `src/apps/`: Entry points for API and Worker.
- `src/modules/auth/`: JWT-based auth and automatic "Favorites" initialization.
- `src/modules/songs/`: Granular song management (catalog, file handling, streaming, and YouTube resolution).
- `src/modules/playlist/`: CRUD operations with dynamic thumbnailing (mosaic of first 4 unique covers).
- `src/modules/discovery/`: Genre-based discovery via Last.fm tags.
- `src/modules/search/`: Last.fm-backed track metadata search.
- `src/modules/recommendation/`: Similarity-based discovery with caching.
- `src/services/`: Shared cross-module services (e.g., `LastFmService`).
- `src/infrastructure/`: Low-level integrations (DB, R2, Queue, Common Guards).

## Key Components

### Unified Playback System (`SongsService`)

The `/songs/play` flow is the core of the app:
1. **Direct Lookup**: Resolves by specific `songId` if provided.
2. **Catalog Match**: Normalizes input `title` + `artist` and checks the `songs` table for an existing record.
3. **YouTube Resolution**: If not found in the catalog, resolves a YouTube source using a multi-signal scoring heuristic (Topics, Vevo, etc.).
4. **Response**: Returns `{ type: 'ready', streamUrl }` if cached in R2, or `{ type: 'job', jobId }` if processing is required.

### Background Job Flow (`SongProcessorService`)

1. Extracts audio via `yt-dlp`.
2. Converts to optimized AAC (`.m4a`) via `ffmpeg`.
3. Uploads to Cloudflare R2 and persists the song entry to the database.
4. Updates BullMQ job data with the final `streamUrl` and `song` metadata.

### Playlist & Library Management

- **Automated Favorites**: New users receive a "Favorites" system playlist on signup. The app protects this playlist from deletion and renames.
- **Dynamic Thumbnailing**: Adding or removing songs automatically triggers a refresh of the `thumbnailUrl` array (max 4 unique covers).
- **Sequencing**:
  - **Adding**: Appends with `max(position) + 1`.
  - **Removing**: Automatic decrementing of `position` for all subsequent songs in the playlist to prevent sequence gaps.

## API Surface

### Authentication
- `POST /auth/signup`: User registration + automated playlist creation.
- `POST /auth/login`: Credential validation.
- `POST /auth/refresh`: Token rotation.
- `POST /auth/logout`: Session termination.

### Songs & Playback
- `POST /songs/play`: Unified playback (returns ready URL or job ID).
- `GET /songs/job/:jobId`: Polling song processing status.
- `GET /songs/getAll`: Listing global catalog.

### Playlists
- `POST /playlist/create`: Create new playlist.
- `GET /playlist/getAll`: List user playlists with song counts.
- `GET /playlist/:id/songs`: Get ordered songs from a playlist.
- `POST /playlist/song/add`: Add song to a playlist (triggers thumbnail update).
- `DELETE /playlist/:id/song/:songId`: Remove song (triggers thumbnail cleanup & re-indexing).
- `DELETE /playlist/:id`: Delete whole playlist (system playlists protected).

### Search & Discovery
- `GET /search?q=...`: Search Last.fm for track metadata.
- `GET /discovery/genre?genre=...`: Get top tracks for a specific genre.
- `GET /recommendations?title=...&artist=...`: Get similar tracks (cached for 15 mins).

## Design Decisions

- **Title/Artist Normalization**: All manual lookups use lowercase, trimmed, bracket-free strings to maximize hit rate.
- **Signed URLs**: Media is never public; R2 generates short-lived URLs for secure streaming.
- **Heuristic Scoring**: YouTube resolution prioritizes "Topic" channels and "Official Video" tags to ensure quality audio.

## Known Limitations

- **Reordering**: Manual drag-and-drop position re-indexing is not yet exposed via a single "batch" endpoint.

## Suggested Maintenance Practice

Update this file before each `git push` if you change:
- Route signatures or Request DTOs.
- Background worker logic or job contracts.
- Database schema (migrations).
- External API integrations (Last.fm, YouTube).
