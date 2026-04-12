import { Inject, Injectable } from "@nestjs/common";
import { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { DRIZZLE_PROVIDER } from "../../infrastructure/database/database.module";
import * as schema from "../../infrastructure/database/schema";
import { and, eq, gt, sql } from "drizzle-orm";


@Injectable()
export class PlaylistRepository {

    constructor(
        @Inject(DRIZZLE_PROVIDER)
        private readonly db: NeonHttpDatabase<typeof schema>,
    ) { }

    async findByIdAndUserId(userId: string, playlistId: string) {
        const playlist = await this.db.query.playlist.findFirst({
            where: and(
                eq(schema.playlist.id, playlistId),
                eq(schema.playlist.userId, userId)
            ),
            columns: { id: true, isSystem: true, thumbnailUrl: true },
        });
        return playlist;
    }

    async deletePlaylist(userId: string, playlistId: string) {
        return await this.db.delete(schema.playlist)
            .where(
                and(
                    eq(schema.playlist.id, playlistId),
                    eq(schema.playlist.userId, userId)
                )
            )
            .returning();
    }

    async removeSongFromPlaylist(playlistId: string, songId: string) {
        // 1️⃣ Get position
        const songEntry = await this.db.query.playlistSongs.findFirst({
            where: and(
                eq(schema.playlistSongs.playlistId, playlistId),
                eq(schema.playlistSongs.songId, songId),
            ),
            columns: { position: true },
        });

        if (!songEntry) return null;

        const deletedPosition = songEntry.position;

        // 2️⃣ Delete
        await this.db
            .delete(schema.playlistSongs)
            .where(
                and(
                    eq(schema.playlistSongs.playlistId, playlistId),
                    eq(schema.playlistSongs.songId, songId),
                ),
            );

        // 3️⃣ Re-order
        await this.db
            .update(schema.playlistSongs)
            .set({
                position: sql`${schema.playlistSongs.position} - 1`,
            })
            .where(
                and(
                    eq(schema.playlistSongs.playlistId, playlistId),
                    gt(schema.playlistSongs.position, deletedPosition),
                ),
            );

        return { success: true };
    }

}