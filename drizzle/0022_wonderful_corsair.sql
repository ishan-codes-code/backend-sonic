ALTER TABLE "songs" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "is_verified" boolean DEFAULT false NOT NULL;