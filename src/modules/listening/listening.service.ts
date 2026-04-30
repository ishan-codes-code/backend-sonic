import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_PROVIDER } from '../../infrastructure/database/database.module';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from '../../infrastructure/database/schema';
import { and, desc, eq, gte } from 'drizzle-orm';
import { RecordPlayDto } from './dto/listening.dto';

@Injectable()
export class ListeningService {
  constructor(
    @Inject(DRIZZLE_PROVIDER)
    private readonly db: NeonHttpDatabase<typeof schema>,
  ) {}

  async recordPlay(userId: string, dto: RecordPlayDto) {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

    // Check if same user played same song in last 30 minutes
    const lastEvent = await this.db.query.listeningEvents.findFirst({
      where: and(
        eq(schema.listeningEvents.userId, userId),
        eq(schema.listeningEvents.songId, dto.songId),
        gte(schema.listeningEvents.playedAt, thirtyMinutesAgo),
      ),
      orderBy: [desc(schema.listeningEvents.playedAt)],
    });

    if (lastEvent) {
      // If new duration is longer, update it. Otherwise keep as is.
      const newDuration = dto.durationListenedSeconds ?? 0;
      if (newDuration > (lastEvent.durationListenedSeconds ?? 0)) {
        const [updated] = await this.db
          .update(schema.listeningEvents)
          .set({
            durationListenedSeconds: newDuration,
            completed: dto.completed ?? lastEvent.completed,
          })
          .where(eq(schema.listeningEvents.id, lastEvent.id))
          .returning();
        return updated;
      }
      return lastEvent;
    }

    // Otherwise insert fresh record
    const [newEvent] = await this.db
      .insert(schema.listeningEvents)
      .values({
        userId,
        songId: dto.songId,
        durationListenedSeconds: dto.durationListenedSeconds ?? 0,
        completed: dto.completed ?? false,
      })
      .returning();

    return newEvent;
  }

  async getUserHistory(userId: string, limit: number, offset: number) {
    const history = await this.db.query.listeningEvents.findMany({
      where: eq(schema.listeningEvents.userId, userId),
      limit,
      offset,
      orderBy: [desc(schema.listeningEvents.playedAt)],
      with: {
        song: {
          with: {
            artists: {
              with: {
                artist: true,
              },
              orderBy: (sa, { asc }) => [asc(sa.position)],
            },
          },
        },
      },
    });

    // Flatten relations for easier consumption, following SongCatalogService pattern
    return history.map((event) => {
      const song = event.song;

      // Type guard to handle Drizzle's inference and avoid the "Property 'artists' does not exist" error
      const processedSong = song && !Array.isArray(song) ? {
        ...song,
        artists: (song as any).artists.map((sa: any) => sa.artist),
      } : null;

      return {
        ...event,
        song: processedSong,
      };
    });
  }
}
