import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { SongProcessorService } from './song-processor.service';
import { SongsModule } from '../../../modules/song/songs.module';
import { SongFilesService } from '../../../modules/song/song-files.service';
import { R2Module } from '../../../infrastructure/r2/r2.module';

@Module({
  imports: [HttpModule, SongsModule, R2Module],
  providers: [SongFilesService, SongProcessorService],
  exports: [SongProcessorService],
})
export class SongProcessorModule { }
