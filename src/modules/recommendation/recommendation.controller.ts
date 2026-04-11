import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../infrastructure/common/guards/jwt-auth.guard';
import { RecommendationService } from './recommendation.service';

@Controller('recommendations')
@UseGuards(JwtAuthGuard)
export class RecommendationController {
  constructor(
    private readonly recommendationService: RecommendationService,
  ) {}

  @Get()
  async getRecommendations(
    @Query('title') title: string,
    @Query('artist') artist: string,
    @Query('limit') limit?: string,
  ) {
    if (!title || title.trim().length === 0) {
      throw new BadRequestException('title is required');
    }

    if (!artist || artist.trim().length === 0) {
      throw new BadRequestException('artist is required');
    }

    const parsedLimit =
      typeof limit === 'string' && limit.trim().length > 0
        ? Number(limit)
        : 20;

    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
      throw new BadRequestException('limit must be a positive number');
    }

    return this.recommendationService.getRecommendations(
      title,
      artist,
      parsedLimit,
    );
  }
}
