import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { R2Service } from '../../infrastructure/r2/r2.service';
import { SongCatalogService } from './song-catalog.service';

@Injectable()
export class SongStreamService {
  constructor(
    private readonly songCatalogService: SongCatalogService,
    private readonly r2Service: R2Service,
  ) {}

  async getStreamUrlBySongId(songId: string) {
    const song = await this.songCatalogService.findById(songId);
    if (!song) {
      throw new HttpException(
        'Song not found in global storage',
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      streamUrl: await this.r2Service.getSignedUrl(song.r2Key),
    };
  }

  async getStreamUrlFromSongKey(r2Key: string): Promise<string> {
    return this.r2Service.getSignedUrl(r2Key);
  }

  async tryGetStreamUrlFromSongKey(r2Key: string): Promise<string | null> {
    try {
      return await this.getStreamUrlFromSongKey(r2Key);
    } catch {
      return null;
    }
  }
}
