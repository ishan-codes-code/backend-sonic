import { Module } from '@nestjs/common';
import { SongsController } from './songs.controller';
import { SongLocalStreamService } from './song-local-stream.service';
import { SongStreamController } from './song-stream.controller';
import { SongsModule } from './songs.module';
import { PlaybackSessionModule } from '../playback-session/playback-session.module';

@Module({
  imports: [SongsModule, PlaybackSessionModule],
  controllers: [SongsController, SongStreamController],
  providers: [SongLocalStreamService],
})
export class SongsApiModule {}
