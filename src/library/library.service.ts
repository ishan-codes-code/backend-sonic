import { SongDto } from 'src/songs/dto/song.dto';
import { SongsService } from 'src/songs/songs.service';
import { Injectable, Inject } from '@nestjs/common';
import { DRIZZLE_PROVIDER } from '../database/database.module';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from '../database/schema';
import { randomUUID } from 'crypto';
import { SongFilesService } from 'src/song-files/song-files.service';


@Injectable()
export class LibraryService {
  constructor(

    private readonly songsService: SongsService,
    private readonly songFilesService: SongFilesService,
    @Inject(DRIZZLE_PROVIDER) private readonly db: NeonHttpDatabase<typeof schema>
  ) { }

  async getUserLibrary(userId: string) {
    return await this.songsService.getUserLibrary(userId);
  }



  async addSong(userId: string, songDto: SongDto) {
    const { youtubeId, title, duration } = songDto;

    let song = await this.songsService.findByYoutubeId(youtubeId);

    if (song) {
      // Song already exists in storage, just add to user library
      await this.songsService.addToUserLibrary(userId, song.id);
      return { success: true, songId: song.id };
    }
    const result = await this.songFilesService.downloadAudio(youtubeId);

    const r2Key = result.r2Key;
    const songId = randomUUID();

    try {
      song = await this.songsService.createSong({
        id: songId,
        ...songDto,
        r2Key,
      })
    } catch (err: any) {
      // If it's a unique constraint violation, try to fetch the song that was just created
      if (err.message?.includes('duplicate key value')) {
        song = await this.songsService.findByYoutubeId(youtubeId);
      } else {
        throw err;
      }
    }

    if (!song) {
      throw new Error('Failed to create or retrieve song after upload.');
    }

    await this.songsService.addToUserLibrary(userId, song.id);

    return {
      success: true,
      songId: song.id,
    };
  }
}
