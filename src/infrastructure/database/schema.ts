import { pgTable, uuid, varchar, boolean, timestamp, text, integer, uniqueIndex, index, primaryKey, pgEnum } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const userRoleEnum = pgEnum('user_role', ['user', 'admin']);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 150 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  emailVerified: boolean('email_verified').default(false),
  favoritesPlaylistId: uuid('favorites_playlist_id').references(() => playlist.id, { onDelete: 'set null' }),
  role: userRoleEnum('role').default('user').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  refreshTokenHash: varchar('refresh_token_hash', { length: 255 }).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});


export const songs = pgTable('songs', {
  id: uuid('id').defaultRandom().primaryKey(),

  // 🎬 SOURCE (AUDIO)
  youtubeId: text('youtube_id').notNull().unique(),
  r2Key: text('r2_key').notNull().unique(),

  // 🎵 METADATA
  trackName: text('track_name').notNull(),
  albumName: text('album_name'),
  duration: integer('duration').notNull(),

  image: text('image'),
  // optional cache
  lastfmId: text('lastfm_id'),

  // 🌐 EXTERNAL MAPPING (OPTIONAL)
  // Used to map this record to external systems (e.g., MusicBrainz, iTunes, etc.)
  externalId: text('external_id'),

  // 🧪 NORMALIZATION (CRITICAL)
  normalizedTrackName: text('normalized_track_name').notNull(),

  // 🛡️ INTERNAL / ADMIN FLAG
  // Used for internal moderation, QA, or admin workflows only (not for public logic)
  isVerified: boolean('is_verified').default(false).notNull(),

  // 🧾 DEBUG / FALLBACK
  youtubeTitle: text('youtube_title'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
});



export const playlist = pgTable('playlist', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 150 }).notNull(),
  description: varchar('description', { length: 255 }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  isPublic: boolean('is_public').default(false).notNull(),
  isSystem: boolean('is_system').default(false).notNull(),
  thumbnailUrl: text('thumbnail_url').array(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
}, (table) => [
  uniqueIndex('unique_user_playlist_name').on(table.userId, table.name),
  index('user_id_idx').on(table.userId),
]);

export const playlistSongs = pgTable('playlist_songs', {
  id: uuid('id').defaultRandom().primaryKey(),
  playlistId: uuid('playlist_id').notNull().references(() => playlist.id, { onDelete: 'cascade' }),
  songId: uuid('song_id').notNull().references(() => songs.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  addedAt: timestamp('added_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('unique_playlist_song_idx').on(table.playlistId, table.songId),
  index('playlist_order_idx').on(table.playlistId, table.position),
  index('playlist_id_idx').on(table.playlistId),
  index('song_id_idx').on(table.songId),
]);



// ─── Artists (permanent) ─────────────────────────────────────────────────────

export const artists = pgTable('artists', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  // Lowercase, symbol-stripped version for dedup (e.g. "jasmine sandlas")
  normalizedName: text('normalized_name').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Many-to-many: song ↔ artist (permanent join table)
export const songArtists = pgTable('song_artists', {
  songId: uuid('song_id').notNull().references(() => songs.id, { onDelete: 'cascade' }),
  artistId: uuid('artist_id').notNull().references(() => artists.id, { onDelete: 'cascade' }),
  // 0 = primary/first artist, 1+ = featured artists (preserves Last.fm order)
  position: integer('position').notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.songId, table.artistId] }),
  index('sa_artist_id_idx').on(table.artistId),
  index('sa_song_id_idx').on(table.songId),
]);

export const listeningEvents = pgTable('listening_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  songId: uuid('song_id').notNull().references(() => songs.id, { onDelete: 'cascade' }),
  playedAt: timestamp('played_at').defaultNow().notNull(),
  durationListenedSeconds: integer('duration_listened_seconds').default(0),
  completed: boolean('completed').default(false),
}, (table) => [
  index('le_user_id_idx').on(table.userId),
  index('le_song_id_idx').on(table.songId),
  index('le_played_at_idx').on(table.playedAt),
]);



// ─── Relations ───────────────────────────────────────────────────────────────

export const listeningEventsRelations = relations(listeningEvents, ({ one }) => ({
  user: one(users, { fields: [listeningEvents.userId], references: [users.id] }),
  song: one(songs, { fields: [listeningEvents.songId], references: [songs.id] }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  playlists: many(playlist),
  listeningEvents: many(listeningEvents),
}));


export const songsRelations = relations(songs, ({ many }) => ({
  artists: many(songArtists),
  listeningEvents: many(listeningEvents),
}));

export const artistsRelations = relations(artists, ({ many }) => ({
  songs: many(songArtists),
}));

export const playlistRelations = relations(playlist, ({ many }) => ({
  songs: many(playlistSongs),
}));

export const playlistSongsRelations = relations(playlistSongs, ({ one }) => ({
  playlist: one(playlist, {
    fields: [playlistSongs.playlistId],
    references: [playlist.id],
  }),
  song: one(songs, {
    fields: [playlistSongs.songId],
    references: [songs.id],
  }),
}));

export const songArtistsRelations = relations(songArtists, ({ one }) => ({
  song: one(songs, {
    fields: [songArtists.songId],
    references: [songs.id],
  }),
  artist: one(artists, {
    fields: [songArtists.artistId],
    references: [artists.id],
  }),
}));
