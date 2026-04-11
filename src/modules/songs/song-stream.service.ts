import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { R2Service } from '../../infrastructure/r2/r2.service';
import { SongCatalogService } from './song-catalog.service';
import { Song } from './dto/play-response.dto';

@Injectable()
export class SongStreamService {
  constructor(
    private readonly songCatalogService: SongCatalogService,
    private readonly r2Service: R2Service,
  ) {}

  async getStreamUrlBySongId(songId: string): Promise<{ type: 'ready'; streamUrl: string; song: Song }> {
    const song = await this.songCatalogService.findById(songId);

    if (!song) {
      throw new HttpException('Song not found', HttpStatus.NOT_FOUND);
    }

    return {
      type: 'ready',
      streamUrl: await this.r2Service.getSignedUrl(song.r2Key),
      song,
    };
  }

  async tryGetStreamUrl(r2Key: string): Promise<string | null> {
    try {
      return await this.r2Service.getSignedUrl(r2Key);
    } catch {
      return null;
    }
  }
}
