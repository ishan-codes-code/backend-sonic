import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../infrastructure/common/guards/jwt-auth.guard';
import { DiscoveryService } from './discovery.service';

@Controller('discovery')
@UseGuards(JwtAuthGuard)
export class DiscoveryController {
  constructor(
    private readonly discoveryService: DiscoveryService,
  ) {}

  @Get('genre')
  async getByGenre(
    @Query('genre') genre: string,
    @Query('limit') limit?: string,
  ) {
    if (!genre || genre.trim().length === 0) {
      throw new BadRequestException('genre is required');
    }

    const parsedLimit =
      typeof limit === 'string' && limit.trim().length > 0
        ? Number(limit)
        : 20;

    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
      throw new BadRequestException('limit must be a positive number');
    }

    return this.discoveryService.getTracksByGenre(
      genre,
      parsedLimit,
    );
  }
}
