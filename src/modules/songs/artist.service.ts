import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { DRIZZLE_PROVIDER } from '../../infrastructure/database/database.module';
import * as schema from '../../infrastructure/database/schema';
import { normalizeString } from '../../shared/utils/string.utils';
import { splitArtists } from '../../shared/utils/artist.utils';

@Injectable()
export class ArtistService {
  private readonly logger = new Logger(ArtistService.name);

  constructor(
    @Inject(DRIZZLE_PROVIDER)
    private readonly db: NeonHttpDatabase<typeof schema>,
  ) {}

  /**
   * High-level method to handle splitting, upserting, and linking artists to a song.
   * This ensures the new relational structure stays in sync with incoming data.
   */
  async linkArtistsToSong(songId: string, rawArtistName: string) {
    const names = splitArtists(rawArtistName);
    
    for (const [index, name] of names.entries()) {
      const norm = normalizeString(name);
      
      try {
        // 1. Get or Create Artist
        let artistId: string;

        const [newArtist] = await this.db
          .insert(schema.artists)
          .values({
            name,
            normalizedName: norm,
          })
          .onConflictDoNothing()
          .returning({ id: schema.artists.id });

        if (newArtist) {
          artistId = newArtist.id;
        } else {
          const [existing] = await this.db
            .select({ id: schema.artists.id })
            .from(schema.artists)
            .where(eq(schema.artists.normalizedName, norm))
            .limit(1);
          
          if (!existing) {
             this.logger.error(`Critical: Artist "${name}" (${norm}) not found after onConflictDoNothing`);
             continue;
          }
          artistId = existing.id;
        }

        // 2. Link to Song
        await this.db
          .insert(schema.songArtists)
          .values({
            songId,
            artistId,
            position: index,
          })
          .onConflictDoNothing();

      } catch (err) {
        this.logger.error(`Failed to link artist "${name}" to song ${songId}: ${err.message}`);
      }
    }
  }
}
