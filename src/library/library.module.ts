import { Module } from '@nestjs/common';
import { LibraryController } from './library.controller';
import { LibraryService } from './library.service';
import { SongsModule } from '../songs/songs.module';
import { SongFilesModule } from 'src/song-files/song-files.module';

@Module({
  imports: [SongsModule, SongFilesModule],
  controllers: [LibraryController],
  providers: [LibraryService],
})
export class LibraryModule { }
