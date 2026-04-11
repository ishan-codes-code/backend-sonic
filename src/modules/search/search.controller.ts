import { Controller, Get, Query, BadRequestException, UseGuards } from '@nestjs/common';
import { LastFmService } from '../../services/lastfm.service';
import { JwtAuthGuard } from '../../infrastructure/common/guards/jwt-auth.guard';

@Controller('search')
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(private readonly lastFmService: LastFmService) { }

  @Get()
  async searchTracks(@Query('q') query: string) {
    if (!query || query.trim().length === 0) {
      throw new BadRequestException('Search query is required');
    }
    return this.lastFmService.searchLastFmTracks(query);
  }
}
