import { BadRequestException, Body, Controller, Get, Param, Post, Sse, UseGuards, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { SongsService } from './songs.service';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { SongDto } from './dto/song.dto';
import { R2Service } from 'src/r2/r2.service';

@Controller('songs')
export class SongsController {
    constructor(
        private readonly songsService: SongsService,
        private readonly r2Service: R2Service,
    ) { }

    @UseGuards(JwtAuthGuard)
    @Post('play')
    async getSong(@Body() songDto: SongDto) {
        return this.songsService.play(songDto);
    }

    @UseGuards(JwtAuthGuard)
    @Get('getAll')
    async getAllSongs() {
        return this.songsService.getAllSongs();
    }


}
