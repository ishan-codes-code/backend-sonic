import { Module } from '@nestjs/common';
import { PlaylistController } from './playlist.controller';
import { PlaylistService } from './playlist.service';
import { PlaylistRepository } from './playlist.repository';
import { PlaybackSessionModule } from '../playback-session/playback-session.module';
import { SongsModule } from '../song/songs.module';

@Module({
  imports: [PlaybackSessionModule, SongsModule],
  controllers: [PlaylistController],
  providers: [PlaylistService, PlaylistRepository],
  exports: [PlaylistService],
})
export class PlaylistModule { }
