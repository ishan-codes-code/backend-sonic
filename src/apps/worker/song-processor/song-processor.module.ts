import { Module } from '@nestjs/common';
import { SongProcessorService } from './song-processor.service';
import { SongsModule } from '../../../modules/songs/songs.module';
import { SongFilesService } from '../../../modules/songs/song-files.service';
import { R2Module } from '../../../infrastructure/r2/r2.module';

@Module({
  imports: [SongsModule, R2Module],
  providers: [SongFilesService, SongProcessorService],
  exports: [SongProcessorService],
})
export class SongProcessorModule {}
