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
import { SongDto } from './dto/song.dto';
import { SongStreamService } from './song-stream.service';

@Controller('songs')
export class SongsController {
  constructor(
    private readonly songsService: SongsService,
    private readonly songStreamService: SongStreamService,
  ) {}

  // @UseGuards(JwtAuthGuard)
  @Get('play/:songId')
  async getUrl(@Param('songId') songId: string) {
    return this.songStreamService.getStreamUrlBySongId(songId);
  }

  // @UseGuards(JwtAuthGuard)
  @Post('play')
  async getSong(@Body() songDto: SongDto) {
    return this.songsService.play(songDto);
  }

  // @UseGuards(JwtAuthGuard)
  @Get('job/:jobId')
  async getSongJob(@Param('jobId') jobId: string) {
    return this.songsService.getJobStatus(jobId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('getAll')
  async getAllSongs() {
    return this.songsService.getAllSongs();
  }
}
