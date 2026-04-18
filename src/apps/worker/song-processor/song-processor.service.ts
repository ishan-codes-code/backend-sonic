import { Injectable, Logger } from '@nestjs/common';
import { SongCatalogService } from '../../../modules/songs/song-catalog.service';
import { SongFilesService } from '../../../modules/songs/song-files.service';
import { SongStreamService } from '../../../modules/songs/song-stream.service';
import { ProcessJobData } from '../../../modules/songs/song-jobs.service';
import { ArtistService } from '../../../modules/songs/artist.service';

@Injectable()
export class SongProcessorService {
  private readonly logger = new Logger(SongProcessorService.name);
  private readonly processingJobs = new Set<string>();
  private readonly failedJobs = new Set<string>();
  private readonly MAX_CONCURRENT = 1;
  private readonly JOB_TIMEOUT_MS = 1_80_000;

  constructor(
    private readonly songFilesService: SongFilesService,
    private readonly songCatalogService: SongCatalogService,
    private readonly songStreamService: SongStreamService,
    private readonly artistService: ArtistService,
  ) {}

  isBusy(youtubeId: string): boolean {
    return (
      !this.processingJobs.has(youtubeId) &&
      this.processingJobs.size >= this.MAX_CONCURRENT
    );
  }

  async handle(data: ProcessJobData): Promise<void> {
    this.logger.log(`Processing youtubeId=${data.youtubeId}`);

    if (this.failedJobs.has(data.youtubeId)) {
      throw new Error(`Previously failed youtubeId=${data.youtubeId}`);
    }

    if (this.processingJobs.has(data.youtubeId)) {
      this.logger.log(`Already processing youtubeId=${data.youtubeId}`);
      return;
    }

    if (this.isBusy(data.youtubeId)) {
      throw new Error('Worker busy');
    }

    this.processingJobs.add(data.youtubeId);

    let timeoutHandle: NodeJS.Timeout | null = null;

    try {
      await Promise.race([
        this.processJob(data),
        new Promise<void>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error('Job timed out')),
            this.JOB_TIMEOUT_MS,
          );
        }),
      ]);

      this.logger.log(`Processing completed youtubeId=${data.youtubeId}`);
    } catch (error) {
      if ((error as Error).message === 'Job timed out') {
        this.logger.error(
          `Processing timed out for youtubeId=${data.youtubeId}`,
        );
      }

      this.failedJobs.add(data.youtubeId);
      this.logger.error(`Processing failed youtubeId=${data.youtubeId}`, error);
      throw error;
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      this.processingJobs.delete(data.youtubeId);
    }
  }

  getStatus(youtubeId: string): 'active' | 'failed' | 'not_found' {
    if (this.failedJobs.has(youtubeId)) {
      return 'failed';
    }

    if (this.processingJobs.has(youtubeId)) {
      return 'active';
    }

    return 'not_found';
  }

  private async processJob(data: ProcessJobData): Promise<void> {
    const { youtubeId } = data;

    // Step 1: Check if song already has an r2Key (may have been processed already)
    let song = await this.songCatalogService.findByYoutubeId(youtubeId);

    if (song?.r2Key) {
      const streamUrl = await this.songStreamService.tryGetStreamUrl(
        song.r2Key,
      );
      if (streamUrl) {
        this.logger.log(`Song already available for youtubeId=${youtubeId}`);
        return;
      }
    }

    // Step 2: Download audio and upload to R2
    this.logger.log(`Downloading audio for youtubeId=${youtubeId}`);
    const result = await this.songFilesService.downloadAudio(youtubeId);

    // Step 3: Create or update DB record
    try {
      song = await this.songCatalogService.create({
        youtubeId,
        trackName: data.trackName,
        normalizedTrackName: data.normalizedTrackName,
        youtubeTitle: data.youtubeTitle,
        image: data.image ?? null,
        r2Key: result.r2Key,
        duration: result.duration,
      });
    } catch (err: any) {
      if (err.message?.includes('duplicate key value')) {
        song = await this.songCatalogService.updateR2Key(
          youtubeId,
          result.r2Key,
          result.duration,
        );
      } else {
        throw err;
      }
    }

    // Phase 4 Dual-Write: Link artists to the song in the new relational tables
    if (song) {
      await this.artistService.linkArtistsToSong(song.id, data.artistName);
    }

    if (!song) {
      throw new Error(
        `Song record not found after processing (youtubeId=${youtubeId})`,
      );
    }

    const streamUrl = await this.songStreamService.tryGetStreamUrl(song.r2Key!);

    if (!streamUrl) {
      throw new Error(`Failed to generate stream URL for r2Key=${song.r2Key}`);
    }

    this.logger.log(
      `Song processing finished for youtubeId=${youtubeId} | songId=${song.id}`,
    );
  }
}
