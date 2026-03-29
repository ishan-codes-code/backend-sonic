import { Module } from '@nestjs/common';
import { SongsService } from './songs.service';
import { SongsController } from './songs.controller';
import { SongFilesModule } from 'src/song-files/song-files.module';
import { R2Module } from 'src/r2/r2.module';
import { JobService } from './job.service';

@Module({
  providers: [SongsService, JobService],
  exports: [SongsService],
  controllers: [SongsController],
  imports: [SongFilesModule, R2Module]
})
export class SongsModule { }
