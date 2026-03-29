import { Injectable, Inject } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { songs, userLibrary } from '../database/schema';
import { DRIZZLE_PROVIDER } from '../database/database.module';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from '../database/schema';
import { SongDto } from './dto/song.dto';
import { PlayResponseDto } from './dto/play-response.dto';
import { SongFilesService } from 'src/song-files/song-files.service';
import { randomUUID } from 'crypto';
import { R2Service } from 'src/r2/r2.service';
import { JobService, SongJobStatusResponse } from './job.service';

@Injectable()
export class SongsService {
  constructor(
    @Inject(DRIZZLE_PROVIDER)
    private readonly db: NeonHttpDatabase<typeof schema>,
    private readonly songFilesService: SongFilesService,
    private readonly r2Service: R2Service,
    private readonly jobService: JobService,
  ) {}

  async findByYoutubeId(youtubeId: string) {
    const results = await this.db
      .select()
      .from(songs)
      .where(eq(songs.youtubeId, youtubeId))
      .limit(1);
    return results[0] || null;
  }

  async findById(id: string) {
    const results = await this.db
      .select()
      .from(songs)
      .where(eq(songs.id, id))
      .limit(1);
    return results[0] || null;
  }

  async createSong(data: {
    id: string;
    youtubeId: string;
    title: string;
    duration: number;
    r2Key: string;
  }) {
    const [newSong] = await this.db
      .insert(songs)
      .values({
        id: data.id,
        youtubeId: data.youtubeId,
        title: data.title,
        duration: data.duration,
        r2Key: data.r2Key,
      })
      .returning();
    return newSong;
  }

  async deleteSong(id: string) {
    await this.db.delete(songs).where(eq(songs.id, id));
  }

  async addToUserLibrary(userId: string, songId: string) {
    // ignore if already exists
    try {
      await this.db
        .insert(userLibrary)
        .values({
          userId,
          songId,
        })
        .onConflictDoNothing();
    } catch (err) {
      console.warn('Conflict adding to user library, likely already there.');
    }
  }

  async isUserOwnsSong(userId: string, songId: string) {
    const results = await this.db
      .select()
      .from(userLibrary)
      .where(
        and(eq(userLibrary.userId, userId), eq(userLibrary.songId, songId)),
      )
      .limit(1);
    return results.length > 0;
  }

  async getUserLibrary(userId: string) {
    // join with songs table
    const results = await this.db
      .select({
        songId: songs.id,
        title: songs.title,
        duration: songs.duration,
        youtubeId: songs.youtubeId,
      })
      .from(userLibrary)
      .innerJoin(songs, eq(userLibrary.songId, songs.id))
      .where(eq(userLibrary.userId, userId));
    return results;
  }

  async getAllSongs() {
    return await this.db
      .select({
        songId: songs.id,
        title: songs.title,
        duration: songs.duration,
        youtubeId: songs.youtubeId,
      })
      .from(songs);
  }

  async play(songDto: SongDto): Promise<PlayResponseDto> {
    const existingSong = await this.findByYoutubeId(songDto.youtubeId);

    if (existingSong) {
      const streamUrl = await this.tryGetStreamUrlFromSong(existingSong.r2Key);

      if (streamUrl) {
        return {
          type: 'ready',
          streamUrl,
        };
      }
    }

    const job = this.jobService.createJob();

    void this.processPlayJob(job.id, songDto);

    return {
      type: 'job',
      jobId: job.id,
    };
  }

  getJobStatus(jobId: string): SongJobStatusResponse | null {
    const job = this.jobService.getJob(jobId);

    if (!job) {
      return null;
    }

    return this.jobService.toStatusResponse(job);
  }

  private async processPlayJob(jobId: string, songDto: SongDto): Promise<void> {
    const { youtubeId, title, duration } = songDto;

    try {
      this.jobService.updateJob(jobId, { progress: 10 });

      let song = await this.findByYoutubeId(youtubeId);

      if (song) {
        this.jobService.updateJob(jobId, { progress: 80 });
        const streamUrl = await this.tryGetStreamUrlFromSong(song.r2Key);

        if (streamUrl) {
          this.jobService.markDone(jobId, streamUrl);
          return;
        }
      }

      if (!title || duration === undefined || duration === null) {
        throw new Error('Title and duration are required');
      }

      this.jobService.updateJob(jobId, { progress: 30 });
      const result = await this.songFilesService.downloadAudio(youtubeId);

      this.jobService.updateJob(jobId, { progress: 70 });

      const songId = randomUUID();

      try {
        song = await this.createSong({
          id: songId,
          youtubeId,
          title,
          duration,
          r2Key: result.r2Key,
        });
      } catch (err: any) {
        if (err.message?.includes('duplicate key value')) {
          song = await this.findByYoutubeId(youtubeId);
        } else {
          throw err;
        }
      }

      if (!song) {
        throw new Error('Failed to create or retrieve song after upload.');
      }

      this.jobService.updateJob(jobId, { progress: 90 });
      const streamUrl = await this.getStreamUrlFromSong(song.r2Key);
      this.jobService.markDone(jobId, streamUrl);
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to process song';
      this.jobService.markError(jobId, errorMessage);
    }
  }

  private async getStreamUrlFromSong(r2Key: string): Promise<string> {
    return this.r2Service.getSignedUrl(r2Key);
  }

  private async tryGetStreamUrlFromSong(r2Key: string): Promise<string | null> {
    try {
      return await this.getStreamUrlFromSong(r2Key);
    } catch (err) {
      return null;
    }
  }
}
