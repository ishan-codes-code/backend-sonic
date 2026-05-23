import { Module } from '@nestjs/common';
import { SongsController } from './songs.controller';
import { SongsModule } from './songs.module';
import { PlaybackSessionModule } from '../playback-session/playback-session.module';

@Module({
  imports: [SongsModule, PlaybackSessionModule],
  controllers: [SongsController],
})
export class SongsApiModule {}
