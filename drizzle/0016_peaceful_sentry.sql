ALTER TABLE "songs" ALTER COLUMN "duration" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "favorites_playlist_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_favorites_playlist_id_playlist_id_fk" FOREIGN KEY ("favorites_playlist_id") REFERENCES "public"."playlist"("id") ON DELETE set null ON UPDATE no action;