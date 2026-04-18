import { and, asc, eq, InferInsertModel } from 'drizzle-orm';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { DRIZZLE_PROVIDER } from '../../infrastructure/database/database.module';
import * as schema from '../../infrastructure/database/schema';
import { Inject, Injectable } from '@nestjs/common';
import { Song } from './dto/play-response.dto';

@Injectable()
export class SongCatalogService {
  constructor(
    @Inject(DRIZZLE_PROVIDER)
    private readonly db: NeonHttpDatabase<typeof schema>,
  ) { }

  async findByYoutubeId(youtubeId: string): Promise<Song | null> {
    const result = await this.db.query.songs.findFirst({
      where: eq(schema.songs.youtubeId, youtubeId),
      with: {
        artists: {
          with: {
            artist: true,
          },
          orderBy: [asc(schema.songArtists.position)],
        },
      },
    });

    if (!result) return null;

    // Flatten relations for easier consumption
    return {
      ...result,
      artists: result.artists.map((sa) => sa.artist),
    };
  }

  async findById(id: string): Promise<Song | null> {
    const result = await this.db.query.songs.findFirst({
      where: eq(schema.songs.id, id),
      with: {
        artists: {
          with: {
            artist: true,
          },
          orderBy: [asc(schema.songArtists.position)],
        },
      },
    });

    if (!result) return null;

    return {
      ...result,
      artists: result.artists.map((sa) => sa.artist),
    };
  }

  async findByNormalizedTrackArtist(
    normalizedTrackName: string,
    normalizedArtistName: string,
  ): Promise<Song | null> {
    // We join artists to see if ANY of the song's artists match the normalizedArtistName.
    // This is more robust than matching a single blob string.
    const results = await this.db
      .selectDistinct({
        song: schema.songs,
      })
      .from(schema.songs)
      .innerJoin(schema.songArtists, eq(schema.songs.id, schema.songArtists.songId))
      .innerJoin(schema.artists, eq(schema.songArtists.artistId, schema.artists.id))
      .where(
        and(
          eq(schema.songs.normalizedTrackName, normalizedTrackName),
          eq(schema.artists.normalizedName, normalizedArtistName),
        ),
      )
      .limit(1);

    if (results.length === 0) return null;

    // Re-fetch with all artists for the found song
    return this.findById(results[0].song.id);
  }

  async create(data: InferInsertModel<typeof schema.songs>): Promise<Song> {
    const [newSong] = await this.db
      .insert(schema.songs)
      .values(data)
      .returning();

    return { ...newSong, artists: [] };
  }

  async updateR2Key(youtubeId: string, r2Key: string, duration?: number): Promise<Song> {
    const [updated] = await this.db
      .update(schema.songs)
      .set({
        r2Key,
        ...(duration != null ? { duration } : {}),
      })
      .where(eq(schema.songs.youtubeId, youtubeId))
      .returning();

    return { ...updated, artists: [] };
  }

  async delete(id: string) {
    await this.db.delete(schema.songs).where(eq(schema.songs.id, id));
  }
}