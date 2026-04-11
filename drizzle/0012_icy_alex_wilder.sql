DROP INDEX "song_unique_idx";--> statement-breakpoint
ALTER TABLE "songs" ALTER COLUMN "youtube_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "songs" ALTER COLUMN "artist" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "songs" ALTER COLUMN "normalized_title" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "songs" ALTER COLUMN "normalized_artist" DROP NOT NULL;