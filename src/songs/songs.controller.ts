import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SongsService } from './songs.service';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { SongDto } from './dto/song.dto';
import { R2Service } from 'src/r2/r2.service';

@Controller('songs')
export class SongsController {
  constructor(
    private readonly songsService: SongsService,
    private readonly r2Service: R2Service,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post('play')
  async getSong(@Body() songDto: SongDto) {
    return this.songsService.play(songDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('play/:songId')
  async getUrl(@Param('songId') songId: string) {
    const song = await this.songsService.findById(songId);
    if (!song) {
      throw new HttpException(
        'Song not found in global storage',
        HttpStatus.NOT_FOUND,
      );
    }

    const streamUrl = await this.r2Service.getSignedUrl(song.r2Key);
    return { streamUrl };
  }

  @UseGuards(JwtAuthGuard)
  @Get('job/:jobId')
  async getSongJob(@Param('jobId') jobId: string) {
    const jobStatus = this.songsService.getJobStatus(jobId);

    if (!jobStatus) {
      throw new NotFoundException('Job not found');
    }

    return jobStatus;
  }

  @UseGuards(JwtAuthGuard)
  @Get('getAll')
  async getAllSongs() {
    return this.songsService.getAllSongs();
  }
}
