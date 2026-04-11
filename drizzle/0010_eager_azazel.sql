ALTER TABLE "songs" RENAME COLUMN "spotify_id" TO "lastfm_id";--> statement-breakpoint
ALTER TABLE "songs" ALTER COLUMN "youtube_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "songs" ALTER COLUMN "artist" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "songs" ALTER COLUMN "r2_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "songs" ALTER COLUMN "normalized_title" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "songs" ALTER COLUMN "normalized_artist" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "song_unique_idx" ON "songs" USING btree ("normalized_title","normalized_artist");