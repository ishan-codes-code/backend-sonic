import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SongCatalogService } from '../../../modules/songs/song-catalog.service';
import { SongFilesService } from '../../../modules/songs/song-files.service';
import { SongStreamService } from '../../../modules/songs/song-stream.service';

@Injectable()
export class SongProcessorService {
  constructor(
    private readonly songFilesService: SongFilesService,
    private readonly songCatalogService: SongCatalogService,
    private readonly songStreamService: SongStreamService,
  ) {}

  async handle(job: any) {
    const { jobId } = job.data;

    console.log('Processing job:', jobId);

    try {
      await this.processPlayJob(job);
      await job.updateProgress(100);
    } catch (error) {
      console.error('Job failed:', jobId, error);
      throw error;
    }
  }

  private async processPlayJob(job: any): Promise<void> {
    const { youtubeId, title, duration } = job.data;

    await job.updateProgress(10);

    let song = await this.songCatalogService.findByYoutubeId(youtubeId);

    if (song) {
      await job.updateProgress(80);

      const streamUrl =
        await this.songStreamService.tryGetStreamUrlFromSongKey(song.r2Key);

      if (streamUrl) {
        await job.updateProgress(100);
        await job.updateData({
          ...job.data,
          streamUrl,
        });
        return;
      }
    }

    if (!title || duration === undefined || duration === null) {
      throw new Error('Title and duration are required');
    }

    await job.updateProgress(30);

    const result = await this.songFilesService.downloadAudio(youtubeId);

    await job.updateProgress(70);

    const songId = randomUUID();

    try {
      song = await this.songCatalogService.create({
        id: songId,
        youtubeId,
        title,
        duration,
        r2Key: result.r2Key,
      });
    } catch (err: any) {
      if (err.message?.includes('duplicate key value')) {
        song = await this.songCatalogService.findByYoutubeId(youtubeId);
      } else {
        throw err;
      }
    }

    if (!song) {
      throw new Error('Failed to create or retrieve song after upload.');
    }

    await job.updateProgress(90);

    const streamUrl =
      await this.songStreamService.tryGetStreamUrlFromSongKey(song.r2Key);

    await job.updateData({
      ...job.data,
      streamUrl,
    });
  }
}
