import { Module } from '@nestjs/common';
import { SongFilesService } from './song-files.service';
import { R2Module } from 'src/r2/r2.module';

@Module({
  providers: [SongFilesService],
  imports: [R2Module],
  exports: [SongFilesService]
})
export class SongFilesModule { }

