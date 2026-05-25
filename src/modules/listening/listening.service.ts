import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DRIZZLE_PROVIDER } from '../../infrastructure/database/database.module';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from '../../infrastructure/database/schema';
import { and, desc, eq, gte } from 'drizzle-orm';
import { ProgressSyncDto, RecordPlayDto } from './dto/listening.dto';
import { TasteSignalDto } from './dto/taste-signal.dto';

@Injectable()
export class ListeningService {
  constructor(
    @Inject(DRIZZLE_PROVIDER)
    private readonly db: NeonHttpDatabase<typeof schema>,
  ) {}

  async recordPlay(userId: string, dto: RecordPlayDto) {
    if (dto.id) {
      const [updated] = await this.db
        .update(schema.listeningEvents)
        .set({
          ...(dto.durationListenedSeconds !== undefined
            ? { durationListenedSeconds: dto.durationListenedSeconds }
            : {}),
          ...(dto.completed !== undefined ? { completed: dto.completed } : {}),
        })
        .where(
          and(
            eq(schema.listeningEvents.id, dto.id),
            eq(schema.listeningEvents.userId, userId),
          ),
        )
        .returning();

      if (!updated) {
        throw new NotFoundException('Listening event not found');
      }

      return updated;
    }

    if (!dto.songId) {
      throw new BadRequestException(
        'Song id is required to create a listening event',
      );
    }

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
      const newDuration = dto.durationListenedSeconds ?? 0;
      const oldDuration = lastEvent.durationListenedSeconds ?? 0;

      // Update if:
      // 1. New duration is strictly greater than the recorded duration.
      // 2. The client is explicitly marking the song completed and it wasn't marked completed before.
      const shouldUpdate =
        newDuration > oldDuration ||
        (dto.completed !== undefined && dto.completed !== lastEvent.completed);

      if (shouldUpdate) {
        const [updated] = await this.db
          .update(schema.listeningEvents)
          .set({
            durationListenedSeconds: Math.max(newDuration, oldDuration),
            completed: dto.completed ?? lastEvent.completed,
          })
          .where(eq(schema.listeningEvents.id, lastEvent.id))
          .returning();
        return updated;
      }
      return lastEvent;
    }

    // Otherwise insert fresh record with foreign-key constraint safety
    try {
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
    } catch (error: any) {
      // Catch foreign key violations (Postgres code 23503)
      if (error && error.code === '23503') {
        throw new NotFoundException(`Song with id '${dto.songId}' not found`);
      }
      throw error;
    }
  }

  async getUserHistory(userId: string, limit: number, offset: number) {
    const history = await this.db.query.listeningEvents.findMany({
      where: eq(schema.listeningEvents.userId, userId),
      limit,
      offset,
      orderBy: [desc(schema.listeningEvents.playedAt)],
      with: {
        song: {
          columns: {
            id: true,
            trackName: true,
            albumName: true,
            image: true,
            duration: true,
            youtubeId: true,
          },
          with: {
            artists: {
              columns: {}, // We only need to fetch the related artist data, not the join table columns
              with: {
                artist: {
                  columns: {
                    id: true,
                    name: true,
                    normalizedName: true,
                  },
                },
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
      const processedSong =
        song && !Array.isArray(song)
          ? {
              ...song,
              artists: (song as any).artists.map((sa: any) => sa.artist),
            }
          : null;

      return {
        ...event,
        song: processedSong,
      };
    });
  }

  async syncProgress(userId: string, dto: ProgressSyncDto) {
    try {
      await this.recordPlay(userId, {
        songId: dto.mediaId,
        durationListenedSeconds: Math.floor(dto.position),
        completed: dto.duration > 0 && dto.duration - dto.position < 5,
      });
      return { success: true };
    } catch (error) {
      // Return 200 (success: true) even on failure to not disrupt RNTP background syncs
      return { success: true };
    }
  }

  async recordTasteSignal(userId: string, dto: TasteSignalDto) {
    try {
      const [newSignal] = await this.db
        .insert(schema.tasteSignals)
        .values({
          userId,
          songId: dto.songId,
          signalType: dto.signalType,
        })
        .returning();
      return newSignal;
    } catch (error) {
      // Fire-and-forget friendly
      return { success: true };
    }
  }

  async getRecentTasteSignals(userId: string, since: Date, limit: number) {
    const signals = await this.db.query.tasteSignals.findMany({
      where: and(
        eq(schema.tasteSignals.userId, userId),
        gte(schema.tasteSignals.createdAt, since),
      ),
      orderBy: [desc(schema.tasteSignals.createdAt)],
      limit,
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

    return signals.map((signal) => {
      const song = signal.song;
      const processedSong =
        song && !Array.isArray(song)
          ? {
              ...song,
              artists: (song as any).artists.map((sa: any) => sa.artist),
            }
          : null;

      return {
        ...signal,
        song: processedSong,
      };
    });
  }

  async deleteHistoryEvent(userId: string, eventId: string) {
    const [deleted] = await this.db
      .delete(schema.listeningEvents)
      .where(
        and(
          eq(schema.listeningEvents.id, eventId),
          eq(schema.listeningEvents.userId, userId),
        ),
      )
      .returning();

    if (!deleted) {
      throw new NotFoundException('Listening event not found or you do not have permission to delete it');
    }

    return { success: true, message: 'Listening event deleted successfully' };
  }
}
