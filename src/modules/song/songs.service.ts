import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PlaySongDto } from './dto/song.dto';
import { PlayResponseDto, ResolvedPlayableSong, Song, toSongDto } from './dto/play-response.dto';
import { SongCatalogService } from './song-catalog.service';
import { SongJobsService } from './song-jobs.service';
import { WorkerCallbackDto } from './dto/song.dto';
import { SongStreamService } from './song-stream.service';
import { YoutubeResolverService } from '../youtube/youtube-resolver.service';
import { normalizeString } from '../../shared/utils/string.utils';
import { ArtistService } from './artist.service';
import { splitArtists } from '../../shared/utils/artist.utils';

@Injectable()
export class SongsService {
  private readonly logger = new Logger(SongsService.name);

  constructor(
    private readonly songCatalogService: SongCatalogService,
    private readonly songJobsService: SongJobsService,
    private readonly songStreamService: SongStreamService,
    private readonly youtubeResolverService: YoutubeResolverService,
    private readonly artistService: ArtistService,
  ) { }


  async streamAudio(id: string): Promise<{ url: string }> {
    const { streamUrl } = await this.songStreamService.getStreamUrlBySongId(id);
    return { url: streamUrl };
  }

  async play(dto: PlaySongDto): Promise<PlayResponseDto> {
    const resolved = await this.resolvePlayableSong(dto);

    // ── CASE 1: Direct by songId ─────────────────────────────────────────────
    if (resolved.type === 'songId') {
      const song = await this.songCatalogService.findById(resolved.songId);
      if (!song) {
        throw new HttpException('Song not found', HttpStatus.NOT_FOUND);
      }
      return { type: 'ready', song: toSongDto(song) };
    }

    // ── CASE 2: Found in DB ──────────────────────────────────────────────────
    if (resolved.type === 'existing') {
      const song = resolved.song;
      return { type: 'ready', song: toSongDto(song) };
    }

    // ── CASE 3: Newly resolved from YouTube ─────────────────────────────────
    if (resolved.type === 'resolved') {
      const job = await this.songJobsService.createProcessJob(resolved.data);
      return { type: 'job', jobId: job.youtubeId };
    }

    throw new Error('Invalid play state');
  }

  async getJobStatus(jobId: string) {
    return this.songJobsService.getJobStatus(jobId);
  }

  handleWorkerCallback(dto: WorkerCallbackDto): void {
    this.songJobsService.handleWorkerCallback(dto);
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  /**
   * Synchronizes metadata (IDs, images, names, artists) for an existing song record.
   * Trust is given to externalId sources for updating names and artist relations.
   */
  private async syncSongMetadata(
    existing: Song,
    dto: PlaySongDto,
    normalizedTrackName: string,
  ): Promise<Song> {
    const updateData: Partial<Song> = {};

    // 1. Sync IDs if missing in DB but present in DTO
    if (!existing.externalId && dto.externalId) {
      updateData.externalId = dto.externalId;
    }
    if (!existing.lastfmId && dto.lastfmId) {
      updateData.lastfmId = dto.lastfmId;
    }

    // 2. Sync Image if missing or mismatch
    if (dto.image && existing.image !== dto.image) {
      updateData.image = dto.image;
    }

    // 3. Sync Track Name if external source (e.g. Spotify) provides it
    if (
      dto.externalId &&
      dto.trackName &&
      existing.trackName !== dto.trackName
    ) {
      updateData.trackName = dto.trackName;
      updateData.normalizedTrackName = normalizedTrackName;
    }

    if (Object.keys(updateData).length > 0) {
      const updated = await this.songCatalogService.updateSong(
        existing.id,
        updateData,
      );
      Object.assign(existing, updated);
    }

    // 4. Sync Artists if external source is trusted
    if (dto.externalId && dto.artistName) {
      const currentNames = existing.artists?.map((a) => a.name) || [];
      const incomingNames = splitArtists(dto.artistName);

      const hasArtistMismatch =
        currentNames.length !== incomingNames.length ||
        currentNames.some((name, i) => name !== incomingNames[i]);

      if (hasArtistMismatch) {
        await this.artistService.syncSongArtists(existing.id, dto.artistName);
        const refreshed = await this.songCatalogService.findById(existing.id);
        if (refreshed) {
          Object.assign(existing, refreshed);
        }
      }
    }

    return existing;
  }

  private async resolvePlayableSong(
    dto: PlaySongDto,
  ): Promise<ResolvedPlayableSong> {
    // Path A: direct songId lookup
    if (dto.songId) {
      return { type: 'songId', songId: dto.songId };
    }

    const normalizedTrackName = normalizeString(dto.trackName!);
    const normalizedArtistName = normalizeString(dto.artistName!);
    const incomingNames = splitArtists(dto.artistName!);
    const normalizedPrimaryArtistName = normalizeString(incomingNames[0]);

    // Path B: external ID dedup lookup
    const existingByExternalId =
      await this.songCatalogService.findByExternalOrLastfmId(
        dto.externalId,
        dto.lastfmId,
      );

    if (existingByExternalId) {
      await this.syncSongMetadata(existingByExternalId, dto, normalizedTrackName);
      return { type: 'existing', song: existingByExternalId };
    }


    // Path C: normalized dedup lookup
    const existing = await this.songCatalogService.findByNormalizedTrackArtist(
      normalizedTrackName,
      normalizedPrimaryArtistName,
    );

    if (existing) {
      await this.syncSongMetadata(existing, dto, normalizedTrackName);
      return { type: 'existing', song: existing };
    }

    // 🛡️ Shield: Check if this specific query has failed before to save YouTube Quota
    await this.songJobsService.checkFailedJobByNames(
      normalizedTrackName,
      normalizedArtistName,
    );

    // 🛡️ Shield: Check if we have the resolved YouTube metadata cached in a busy job (saves 100 quota units)
    const cachedBusyJob = this.songJobsService.getBusyJobByNames(
      normalizedTrackName,
      normalizedPrimaryArtistName,
    );
    if (cachedBusyJob) {
      return {
        type: 'resolved',
        data: cachedBusyJob,
      };
    }

    // Path D: resolve via YouTube, then insert stub record
    const ytSong = await this.youtubeResolverService.resolveFromTrackAndArtist(
      dto.trackName!,
      dto.artistName!,
    );

    // Dedup by youtubeId before inserting
    const existingByYtId = await this.songCatalogService.findByYoutubeId(
      ytSong.youtubeId,
    );
    if (existingByYtId) {
      await this.syncSongMetadata(existingByYtId, dto, normalizedTrackName);
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
        image: dto.image ?? null,
        externalId: dto.externalId,
        lastfmId: dto.lastfmId,
      },
    };
  }
}
