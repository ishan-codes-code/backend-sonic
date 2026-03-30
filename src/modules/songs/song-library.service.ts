import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { DRIZZLE_PROVIDER } from '../../infrastructure/database/database.module';
import * as schema from '../../infrastructure/database/schema';

@Injectable()
export class SongLibraryService {
  constructor(
    @Inject(DRIZZLE_PROVIDER)
    private readonly db: NeonHttpDatabase<typeof schema>,
  ) {}

  async addToUserLibrary(userId: string, songId: string) {
    try {
      await this.db
        .insert(schema.userLibrary)
        .values({ userId, songId })
        .onConflictDoNothing();
    } catch {
      console.warn('Conflict adding to user library, likely already there.');
    }
  }

  async getUserLibrary(userId: string) {
    return this.db
      .select({
        songId: schema.songs.id,
        title: schema.songs.title,
        duration: schema.songs.duration,
        youtubeId: schema.songs.youtubeId,
      })
      .from(schema.userLibrary)
      .innerJoin(schema.songs, eq(schema.userLibrary.songId, schema.songs.id))
      .where(eq(schema.userLibrary.userId, userId));
  }

  async isOwnedByUser(userId: string, songId: string) {
    const results = await this.db
      .select()
      .from(schema.userLibrary)
      .where(
        and(
          eq(schema.userLibrary.userId, userId),
          eq(schema.userLibrary.songId, songId),
        ),
      )
      .limit(1);

    return results.length > 0;
  }
}
