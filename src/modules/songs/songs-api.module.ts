import { Module } from '@nestjs/common';
import { SongsController } from './songs.controller';
import { SongsModule } from './songs.module';

@Module({
  imports: [SongsModule],
  controllers: [SongsController],
})
export class SongsApiModule {}
