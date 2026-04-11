DROP INDEX "unique_youtube_id_idx";--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "artist" text;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "album" text;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "spotify_id" text;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "normalized_title" text;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "normalized_artist" text;--> statement-breakpoint
ALTER TABLE "songs" DROP COLUMN "title_raw";--> statement-breakpoint
ALTER TABLE "songs" DROP COLUMN "title_clean";--> statement-breakpoint
ALTER TABLE "songs" DROP COLUMN "artist_name";--> statement-breakpoint
ALTER TABLE "songs" DROP COLUMN "track_name";--> statement-breakpoint
ALTER TABLE "songs" DROP COLUMN "metadata_confidence";--> statement-breakpoint
ALTER TABLE "songs" DROP COLUMN "metadata_source";--> statement-breakpoint
ALTER TABLE "songs" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "songs" DROP COLUMN "enrichment_status";--> statement-breakpoint
ALTER TABLE "songs" DROP COLUMN "retry_count";