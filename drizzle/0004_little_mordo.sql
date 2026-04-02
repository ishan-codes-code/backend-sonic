CREATE TABLE "playlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(150) NOT NULL,
	"description" varchar(255),
	"user_id" uuid NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playlist_songs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"playlist_id" uuid NOT NULL,
	"song_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "user_library" CASCADE;--> statement-breakpoint
ALTER TABLE "playlist" ADD CONSTRAINT "playlist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_songs" ADD CONSTRAINT "playlist_songs_playlist_id_playlist_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."playlist"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_songs" ADD CONSTRAINT "playlist_songs_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unique_user_playlist_name" ON "playlist" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "user_id_idx" ON "playlist" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_playlist_song_idx" ON "playlist_songs" USING btree ("playlist_id","song_id");--> statement-breakpoint
CREATE INDEX "playlist_order_idx" ON "playlist_songs" USING btree ("playlist_id","position");--> statement-breakpoint
CREATE INDEX "playlist_id_idx" ON "playlist_songs" USING btree ("playlist_id");--> statement-breakpoint
CREATE INDEX "song_id_idx" ON "playlist_songs" USING btree ("song_id");