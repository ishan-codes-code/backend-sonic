import { Injectable } from '@nestjs/common';
import { SongDto } from './dto/song.dto';
import { PlayResponseDto } from './dto/play-response.dto';
import { SongCatalogService } from './song-catalog.service';
import { SongJobsService } from './song-jobs.service';
import { SongStreamService } from './song-stream.service';

@Injectable()
export class SongsService {
  constructor(
    private readonly songCatalogService: SongCatalogService,
    private readonly songJobsService: SongJobsService,
    private readonly songStreamService: SongStreamService,
  ) {}

  async findByYoutubeId(youtubeId: string) {
    return this.songCatalogService.findByYoutubeId(youtubeId);
  }

  async findById(id: string) {
    return this.songCatalogService.findById(id);
  }

  async createSong(data: {
    id: string;
    youtubeId: string;
    title: string;
    duration: number;
    r2Key: string;
  }) {
    return this.songCatalogService.create(data);
  }

  async deleteSong(id: string) {
    await this.songCatalogService.delete(id);
  }

  async getAllSongs() {
    return this.songCatalogService.getAll();
  }

  async play(songDto: SongDto): Promise<PlayResponseDto> {
    const existingSong = await this.findByYoutubeId(songDto.youtubeId);

    if (existingSong) {
      const streamUrl = await this.songStreamService.tryGetStreamUrlFromSongKey(
        existingSong.r2Key,
      );

      if (streamUrl) {
        return {
          type: 'ready',
          streamUrl,
        };
      }
    }

    const job = await this.songJobsService.createPlayJob(songDto);

    return {
      type: 'job',
      jobId: job.id!,
    };
  }

  async getJobStatus(jobId: string) {
    return this.songJobsService.getJobStatus(jobId);
  }
}
