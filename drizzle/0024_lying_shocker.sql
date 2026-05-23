DROP INDEX "le_user_id_idx";--> statement-breakpoint
DROP INDEX "le_played_at_idx";--> statement-breakpoint
CREATE INDEX "le_user_played_idx" ON "listening_events" USING btree ("user_id","played_at");--> statement-breakpoint
CREATE INDEX "le_user_song_played_idx" ON "listening_events" USING btree ("user_id","song_id","played_at");