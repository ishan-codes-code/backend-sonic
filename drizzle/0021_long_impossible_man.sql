CREATE TABLE "listening_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"song_id" uuid NOT NULL,
	"played_at" timestamp DEFAULT now() NOT NULL,
	"duration_listened_seconds" integer DEFAULT 0,
	"completed" boolean DEFAULT false
);
--> statement-breakpoint
ALTER TABLE "listening_events" ADD CONSTRAINT "listening_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listening_events" ADD CONSTRAINT "listening_events_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "le_user_id_idx" ON "listening_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "le_song_id_idx" ON "listening_events" USING btree ("song_id");--> statement-breakpoint
CREATE INDEX "le_played_at_idx" ON "listening_events" USING btree ("played_at");