import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { LastFmService } from '../../services/lastfm.service';
import { RecommendationController } from './recommendation.controller';
import { RecommendationService } from './recommendation.service';
import { SongsModule } from '../songs/songs.module';
import { YoutubeModule } from '../youtube/youtube.module';

@Module({
  imports: [HttpModule, SongsModule, YoutubeModule],
  controllers: [RecommendationController],
  providers: [LastFmService, RecommendationService],
})
export class RecommendationModule { }
