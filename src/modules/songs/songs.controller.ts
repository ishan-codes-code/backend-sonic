import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SongsService } from './songs.service';
import { JwtAuthGuard } from '../../infrastructure/common/guards/jwt-auth.guard';
import { PlaySongDto } from './dto/song.dto';
import { SongStreamService } from './song-stream.service';

@Controller('songs')
export class SongsController {
  constructor(
    private readonly songsService: SongsService,
    private readonly songStreamService: SongStreamService,
  ) { }



  // @UseGuards(JwtAuthGuard)
  @Post('play')
  async playSongResolver(@Body() dto: PlaySongDto) {
    return this.songsService.play(dto);

  }

  // @UseGuards(JwtAuthGuard)
  @Get('job/:jobId')
  async getSongJob(@Param('jobId') jobId: string) {
    return this.songsService.getJobStatus(jobId);
  }


}
