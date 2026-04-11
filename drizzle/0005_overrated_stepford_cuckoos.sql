ALTER TABLE "playlist" ADD COLUMN "thumbnail" text[];--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "channel_name" text;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "channel_id" text;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "thumbnail_url" text;