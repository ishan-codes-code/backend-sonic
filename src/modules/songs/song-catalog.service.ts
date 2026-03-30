import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { DRIZZLE_PROVIDER } from '../../infrastructure/database/database.module';
import * as schema from '../../infrastructure/database/schema';

@Injectable()
export class SongCatalogService {
  constructor(
    @Inject(DRIZZLE_PROVIDER)
    private readonly db: NeonHttpDatabase<typeof schema>,
  ) {}

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

  async create(data: {
    id: string;
    youtubeId: string;
    title: string;
    duration: number;
    r2Key: string;
  }) {
    const [newSong] = await this.db
      .insert(schema.songs)
      .values(data)
      .returning();

    return newSong;
  }

  async delete(id: string) {
    await this.db.delete(schema.songs).where(eq(schema.songs.id, id));
  }

  async getAll() {
    return this.db
      .select({
        songId: schema.songs.id,
        title: schema.songs.title,
        duration: schema.songs.duration,
        youtubeId: schema.songs.youtubeId,
      })
      .from(schema.songs);
  }

}
