import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ListeningService } from './listening.service';
import { JwtAuthGuard } from '../../infrastructure/common/guards/jwt-auth.guard';
import { GetCurrentUser } from '../../infrastructure/common/decorators/get-current-user.decorator';
import { GetHistoryQueryDto, RecordPlayDto } from './dto/listening.dto';

@Controller('listening')
export class ListeningController {
  constructor(private readonly listeningService: ListeningService) {}

  @UseGuards(JwtAuthGuard)
  @Post('event')
  async recordPlay(@GetCurrentUser() user: any, @Body() dto: RecordPlayDto) {
    return this.listeningService.recordPlay(user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('history')
  async getHistory(@GetCurrentUser() user: any, @Query() query: GetHistoryQueryDto) {
    return this.listeningService.getUserHistory(
      user.id,
      query.limit ?? 20,
      query.offset ?? 0,
    );
  }
}
