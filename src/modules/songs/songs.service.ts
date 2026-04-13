import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PlaySongDto } from './dto/song.dto';
import { PlayResponseDto, ResolvedPlayableSong } from './dto/play-response.dto';
import { SongCatalogService } from './song-catalog.service';
import { SongJobsService } from './song-jobs.service';
import { SongStreamService } from './song-stream.service';
import { YoutubeResolverService } from './youtube-resolver.service';
import { normalizeString } from '../../shared/utils/string.utils';

@Injectable()
export class SongsService {
  private readonly logger = new Logger(SongsService.name);

  constructor(
    private readonly songCatalogService: SongCatalogService,
    private readonly songJobsService: SongJobsService,
    private readonly songStreamService: SongStreamService,
    private readonly youtubeResolverService: YoutubeResolverService,
  ) { }

  async play(dto: PlaySongDto): Promise<PlayResponseDto> {
    const resolved = await this.resolvePlayableSong(dto);

    // ── CASE 1: Direct by songId ─────────────────────────────────────────────
    if (resolved.type === 'songId') {
      return this.songStreamService.getStreamUrlBySongId(resolved.songId);
    }

    // ── CASE 2: Found in DB ──────────────────────────────────────────────────
    if (resolved.type === 'existing') {
      const song = resolved.song;

      // Note: r2Key is non-nullable in schema; if record exists, it has a key.
      const streamUrl = await this.songStreamService.tryGetStreamUrl(song.r2Key);

      if (streamUrl) {
        return { type: 'ready', streamUrl, song };
      }

      // Fallback: If signed URL fails (e.g. file missing from R2), trigger re-processing.
      const job = await this.songJobsService.createProcessJob({
        youtubeId: song.youtubeId,
        songId: song.id,
        trackName: song.trackName,
        artistName: song.artistName,
        youtubeTitle: song.youtubeTitle ?? song.trackName,
        normalizedTrackName: song.normalizedTrackName,
        normalizedArtistName: song.normalizedArtistName,
        image: song.image ?? undefined,
      });

      return { type: 'job', jobId: job.id! };
    }

    // ── CASE 3: Newly resolved from YouTube ─────────────────────────────────
    if (resolved.type === 'resolved') {
      const job = await this.songJobsService.createProcessJob(resolved.data);
      return { type: 'job', jobId: job.id! };
    }

    throw new Error('Invalid play state');
  }


  async getJobStatus(jobId: string) {
    return this.songJobsService.getJobStatus(jobId);
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private async resolvePlayableSong(dto: PlaySongDto): Promise<ResolvedPlayableSong> {
    // Path A: direct songId lookup
    if (dto.songId) {
      return { type: 'songId', songId: dto.songId };
    }

    const normalizedTrackName = normalizeString(dto.trackName!);
    const normalizedArtistName = normalizeString(dto.artistName!);

    // Path B: normalized dedup lookup
    const existing = await this.songCatalogService.findByNormalizedTrackArtist(
      normalizedTrackName,
      normalizedArtistName,
    );

    if (existing) {
      return { type: 'existing', song: existing };
    }

    // 🛡️ Shield: Check if this specific query has failed before to save YouTube Quota
    await this.songJobsService.checkFailedJobByNames(
      normalizedTrackName,
      normalizedArtistName,
    );

    // Path C: resolve via YouTube, then insert stub record
    const ytSong = await this.youtubeResolverService.resolveFromTrackAndArtist(
      dto.trackName!,
      dto.artistName!,
    );

    // Dedup by youtubeId before inserting
    const existingByYtId = await this.songCatalogService.findByYoutubeId(ytSong.youtubeId);
    if (existingByYtId) {
      return { type: 'existing', song: existingByYtId };
    }

    return {
      type: 'resolved',
      data: {
        youtubeId: ytSong.youtubeId,
        trackName: dto.trackName!,
        artistName: dto.artistName!,
        normalizedTrackName,
        normalizedArtistName,
        youtubeTitle: ytSong.youtubeTitle,
        image: ytSong.image ?? undefined,
      },
    };

  }
}
