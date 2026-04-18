import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { R2Module } from '../../infrastructure/r2/r2.module';
import { SongCatalogService } from './song-catalog.service';

import { SongJobsService } from './song-jobs.service';
import { SongStreamService } from './song-stream.service';
import { SongsService } from './songs.service';
import { ArtistService } from './artist.service';
import { YoutubeResolverService } from './youtube-resolver.service';

@Module({
  imports: [HttpModule, R2Module],
  providers: [
    SongsService,
    SongCatalogService,
    SongJobsService,
    SongStreamService,
    ArtistService,
    YoutubeResolverService,
  ],
  exports: [
    SongsService,
    SongCatalogService,
    SongJobsService,
    SongStreamService,
    ArtistService,
    YoutubeResolverService,
  ],
})
export class SongsModule {}
