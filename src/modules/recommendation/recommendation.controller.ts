import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../infrastructure/common/guards/jwt-auth.guard';
import { GetCurrentUser } from '../../infrastructure/common/decorators/get-current-user.decorator';
import { RecommendationQueryDto } from './dto/recommendation.dto';
import { RecommendationService } from './recommendation.service';

@Controller('recommend')
@UseGuards(JwtAuthGuard)
export class RecommendationController {
  constructor(
    private readonly recommendationService: RecommendationService,
  ) {}

  @Get()
  async getRecommendations(
    @GetCurrentUser() user: any,
    @Query() query: RecommendationQueryDto,
  ) {
    return this.recommendationService.getRecommendationsForUser(
      user.id,
      query.limit ?? 20,
    );
  }
}
