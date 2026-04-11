import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { LastFmService } from '../../services/lastfm.service';
import { RecommendationController } from './recommendation.controller';
import { RecommendationService } from './recommendation.service';

@Module({
  imports: [HttpModule],
  controllers: [RecommendationController],
  providers: [LastFmService, RecommendationService],
})
export class RecommendationModule {}
