ALTER TABLE "playlist" RENAME COLUMN "thumbnail" TO "thumbnail_url";--> statement-breakpoint
ALTER TABLE "songs" DROP COLUMN "thumbnail_url";