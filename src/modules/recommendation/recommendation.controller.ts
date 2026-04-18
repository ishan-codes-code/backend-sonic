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
    @Query('artists') artistsRaw: string,
    @Query('limit') limit?: string,
  ) {
    if (!title || title.trim().length === 0) {
      throw new BadRequestException('title is required');
    }

    if (!artistsRaw) {
      throw new BadRequestException('artists is required');
    }

    let artists: any[];
    try {
      artists = typeof artistsRaw === 'string' ? JSON.parse(artistsRaw) : artistsRaw;
    } catch {
      throw new BadRequestException('artists must be a valid JSON array');
    }

    if (!Array.isArray(artists) || artists.length === 0) {
      throw new BadRequestException('artists must be a non-empty array');
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
      artists,
      parsedLimit,
    );
  }
}
