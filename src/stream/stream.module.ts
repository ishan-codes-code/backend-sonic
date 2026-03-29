import { Module } from '@nestjs/common';
import { StreamService } from './stream.service';
import { SongsModule } from 'src/songs/songs.module';
import { R2Module } from 'src/r2/r2.module';
import { StreamController } from './stream.controller';

@Module({
  imports: [SongsModule, R2Module],
  providers: [StreamService],
  exports: [StreamService],
  controllers: [StreamController],
})
export class StreamModule { }
