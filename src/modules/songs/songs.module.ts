import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { QueueModule } from '../../infrastructure/queue/queue.module';
import { R2Module } from '../../infrastructure/r2/r2.module';
import { SongCatalogService } from './song-catalog.service';
import { SongFilesService } from './song-files.service';
import { SongJobsService } from './song-jobs.service';
import { SongStreamService } from './song-stream.service';
import { SongsService } from './songs.service';
import { YoutubeResolverService } from './youtube-resolver.service';

@Module({
  imports: [HttpModule, R2Module, QueueModule],
  providers: [
    SongsService,
    SongCatalogService,
    SongFilesService,
    SongJobsService,
    SongStreamService,
    YoutubeResolverService,
  ],
  exports: [
    SongsService,
    SongCatalogService,
    SongFilesService,
    SongJobsService,
    SongStreamService,
    YoutubeResolverService,
  ],
})
export class SongsModule { }
