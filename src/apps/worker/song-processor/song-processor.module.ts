import { Module } from '@nestjs/common';
import { SongProcessorService } from './song-processor.service';
import { SongsModule } from '../../../modules/songs/songs.module';

@Module({
  imports: [SongsModule],
  providers: [SongProcessorService],
  exports: [SongProcessorService],
})
export class SongProcessorModule {}
