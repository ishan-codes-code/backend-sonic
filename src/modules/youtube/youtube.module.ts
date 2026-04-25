import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { YoutubeResolverService } from './youtube-resolver.service';
import { YoutubeScorerService } from './youtube-scorer.service';

@Module({
  imports: [HttpModule],
  providers: [YoutubeResolverService, YoutubeScorerService],
  exports: [YoutubeResolverService],
})
export class YoutubeModule {}
