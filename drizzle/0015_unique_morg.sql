ALTER TABLE "songs" ADD COLUMN "track_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "artist_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "album_name" text;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "normalized_track_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "normalized_artist_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "youtube_title" text;--> statement-breakpoint
ALTER TABLE "songs" DROP COLUMN "title";--> statement-breakpoint
ALTER TABLE "songs" DROP COLUMN "artist";--> statement-breakpoint
ALTER TABLE "songs" DROP COLUMN "album";--> statement-breakpoint
ALTER TABLE "songs" DROP COLUMN "channel_name";--> statement-breakpoint
ALTER TABLE "songs" DROP COLUMN "channel_id";--> statement-breakpoint
ALTER TABLE "songs" DROP COLUMN "normalized_title";--> statement-breakpoint
ALTER TABLE "songs" DROP COLUMN "normalized_artist";--> statement-breakpoint
ALTER TABLE "songs" ADD CONSTRAINT "songs_r2_key_unique" UNIQUE("r2_key");