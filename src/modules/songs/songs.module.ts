import { Module } from '@nestjs/common';
import { QueueModule } from '../../infrastructure/queue/queue.module';
import { R2Module } from '../../infrastructure/r2/r2.module';
import { SongCatalogService } from './song-catalog.service';
import { SongFilesService } from './song-files.service';
import { SongJobsService } from './song-jobs.service';
import { SongLibraryService } from './song-library.service';
import { SongStreamService } from './song-stream.service';
import { SongsService } from './songs.service';

@Module({
  imports: [R2Module, QueueModule],
  providers: [
    SongsService,
    SongCatalogService,
    SongFilesService,
    SongJobsService,
    SongLibraryService,
    SongStreamService,
  ],
  exports: [
    SongsService,
    SongCatalogService,
    SongFilesService,
    SongJobsService,
    SongLibraryService,
    SongStreamService,
  ],
})
export class SongsModule {}
