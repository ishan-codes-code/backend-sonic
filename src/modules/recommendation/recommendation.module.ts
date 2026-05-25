import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { LastFmService } from '../../services/lastfm.service';
import { RecommendationController } from './recommendation.controller';
import { RecommendationService } from './recommendation.service';
import { ListeningModule } from '../listening/listening.module';

@Module({
  imports: [HttpModule, ListeningModule],
  controllers: [RecommendationController],
  providers: [LastFmService, RecommendationService],
})
export class RecommendationModule { }
