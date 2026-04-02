import { Inject, Injectable } from "@nestjs/common";
import { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { DRIZZLE_PROVIDER } from "src/infrastructure/database/database.module";
import * as schema from "../../infrastructure/database/schema";
import { and, eq } from "drizzle-orm";


@Injectable()
export class PlaylistRepository {

    constructor(
        @Inject(DRIZZLE_PROVIDER)
        private readonly db: NeonHttpDatabase<typeof schema>,
    ) { }

    async returnPlaylistId(userId: string, playlistId: string) {
        const playlist = await this.db.query.playlist.findFirst({
            where: and(
                eq(schema.playlist.id, playlistId),
                eq(schema.playlist.userId, userId)
            ),
            columns: { id: true },
        });
        return playlist
    }

}