import { and, eq, InferInsertModel } from 'drizzle-orm';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { DRIZZLE_PROVIDER } from '../../infrastructure/database/database.module';
import * as schema from '../../infrastructure/database/schema';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class SongCatalogService {
  constructor(
    @Inject(DRIZZLE_PROVIDER)
    private readonly db: NeonHttpDatabase<typeof schema>,
  ) { }

  async findByYoutubeId(youtubeId: string) {
    const results = await this.db
      .select()
      .from(schema.songs)
      .where(eq(schema.songs.youtubeId, youtubeId))
      .limit(1);

    return results[0] || null;
  }

  async findById(id: string) {
    const results = await this.db
      .select()
      .from(schema.songs)
      .where(eq(schema.songs.id, id))
      .limit(1);

    return results[0] || null;
  }

  async findByNormalizedTrackArtist(
    normalizedTrackName: string,
    normalizedArtistName: string,
  ) {
    const results = await this.db
      .select()
      .from(schema.songs)
      .where(
        and(
          eq(schema.songs.normalizedTrackName, normalizedTrackName),
          eq(schema.songs.normalizedArtistName, normalizedArtistName),
        ),
      )
      .limit(1);

    return results[0] || null;
  }

  async create(data: InferInsertModel<typeof schema.songs>) {
    const [newSong] = await this.db
      .insert(schema.songs)
      .values(data)
      .returning();


    return newSong;
  }

  async updateR2Key(youtubeId: string, r2Key: string, duration?: number) {
    const [updated] = await this.db
      .update(schema.songs)
      .set({
        r2Key,
        ...(duration != null ? { duration } : {}),
      })
      .where(eq(schema.songs.youtubeId, youtubeId))
      .returning();

    return updated;
  }

  async delete(id: string) {
    await this.db.delete(schema.songs).where(eq(schema.songs.id, id));
  }
}