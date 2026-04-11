import { Injectable, Logger } from '@nestjs/common';
import { SongCatalogService } from '../../../modules/songs/song-catalog.service';
import { SongFilesService } from '../../../modules/songs/song-files.service';
import { SongStreamService } from '../../../modules/songs/song-stream.service';

@Injectable()
export class SongProcessorService {
  private readonly logger = new Logger(SongProcessorService.name);

  constructor(
    private readonly songFilesService: SongFilesService,
    private readonly songCatalogService: SongCatalogService,
    private readonly songStreamService: SongStreamService,
  ) { }

  async handle(job: any): Promise<void> {
    this.logger.log(`Processing job ${job.id} | youtubeId=${job.data.youtubeId}`);

    try {
      await this.processJob(job);
      await job.updateProgress(100);
    } catch (error) {
      this.logger.error(`Job ${job.id} failed`, error);
      throw error;
    }
  }

  private async processJob(job: any): Promise<void> {
    const { youtubeId } = job.data;

    await job.updateProgress(10);

    // Step 1: Check if song already has an r2Key (may have been processed already)
    let song = await this.songCatalogService.findByYoutubeId(youtubeId);

    if (song?.r2Key) {
      const streamUrl = await this.songStreamService.tryGetStreamUrl(song.r2Key);
      if (streamUrl) {
        await job.updateProgress(100);
        await job.updateData({ ...job.data, streamUrl, song });
        return;
      }
    }

    // Step 2: Download audio and upload to R2
    await job.updateProgress(19);
    this.logger.log(`Downloading audio for youtubeId=${youtubeId}`);

    const result = await this.songFilesService.downloadAudio(youtubeId);

    await job.updateProgress(79);

    // Step 3: Create DB record

    try {
      song = await this.songCatalogService.create({
        youtubeId,
        trackName: job.data.trackName,
        artistName: job.data.artistName,
        normalizedTrackName: job.data.normalizedTrackName,
        normalizedArtistName: job.data.normalizedArtistName,
        youtubeTitle: job.data.youtubeTitle,
        image: job.data.image ?? null,
        r2Key: result.r2Key,
        duration: result.duration,
      });


    } catch (err: any) {
      if (err.message?.includes('duplicate key value')) {
        song = await this.songCatalogService.updateR2Key(youtubeId, result.r2Key, result.duration);
      } else {
        throw err;
      }
    }


    await job.updateProgress(90);

    // Refresh song record so we have the latest entity (and avoid null if create failed but update succeeded)
    // song = await this.songCatalogService.findByYoutubeId(youtubeId);

    if (!song) {
      throw new Error(`Song record not found after processing (youtubeId=${youtubeId})`);
    }

    const streamUrl = await this.songStreamService.tryGetStreamUrl(song.r2Key!);

    if (!streamUrl) {
      throw new Error(`Failed to generate stream URL for r2Key=${song.r2Key}`);
    }

    await job.updateData({ ...job.data, streamUrl, song });

    this.logger.log(`Job ${job.id} completed | songId=${song.id}`);
  }
}
