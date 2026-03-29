CREATE TABLE "songs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"youtube_id" text NOT NULL,
	"title" text NOT NULL,
	"duration" integer,
	"r2_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "songs_youtube_id_unique" UNIQUE("youtube_id")
);
--> statement-breakpoint
CREATE TABLE "user_library" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"song_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_library" ADD CONSTRAINT "user_library_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_library" ADD CONSTRAINT "user_library_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unique_youtube_id_idx" ON "songs" USING btree ("youtube_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_user_song_idx" ON "user_library" USING btree ("user_id","song_id");--> statement-breakpoint
CREATE INDEX "user_id_idx" ON "user_library" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "song_id_idx" ON "user_library" USING btree ("song_id");