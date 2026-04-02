import { pgTable, uuid, varchar, boolean, timestamp, text, integer, uniqueIndex, index } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 150 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  emailVerified: boolean('email_verified').default(true),
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

  youtubeId: text('youtube_id').notNull().unique(),
  title: text('title').notNull(),

  // ✅ NEW: creator info
  channelName: text('channel_name'),     // optional (for now)
  channelId: text('channel_id'),         // optional but IMPORTANT


  duration: integer('duration'), // in seconds
  r2Key: text('r2_key').notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('unique_youtube_id_idx').on(table.youtubeId),

  // ✅ optional but smart (for faster queries later)
  // index('channel_id_idx').on(table.channelId),
]);


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