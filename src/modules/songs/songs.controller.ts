import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { SongsService } from './songs.service';
import { JwtAuthGuard } from '../../infrastructure/common/guards/jwt-auth.guard';
import { PlaySongDto } from './dto/song.dto';

@Controller('songs')
export class SongsController {
  constructor(private readonly songsService: SongsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('play')
  async playSongResolver(@Body() dto: PlaySongDto) {
    return this.songsService.play(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('job/:jobId')
  async getSongJob(@Param('jobId') youtubeId: string) {
    return this.songsService.getJobStatus(youtubeId);
  }
}
