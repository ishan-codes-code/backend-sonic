ALTER TABLE "songs" ADD COLUMN "title_raw" text;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "title_clean" text;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "artist_name" text;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "track_name" text;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "metadata_confidence" text;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "metadata_source" text;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "status" text DEFAULT 'processing';--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "enrichment_status" text DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "retry_count" integer DEFAULT 0;