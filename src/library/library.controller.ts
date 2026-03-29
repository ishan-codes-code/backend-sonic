import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { LibraryService } from './library.service';
import { GetCurrentUser } from '../common/decorators/get-current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SongDto } from 'src/songs/dto/song.dto';

@Controller('library')
export class LibraryController {
  constructor(private readonly libraryService: LibraryService) { }

  @UseGuards(JwtAuthGuard)
  @Get()
  async getLibrary(@GetCurrentUser('id') userId: string) {
    return await this.libraryService.getUserLibrary(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('addSong')
  async addSong(
    @GetCurrentUser('id') userId: string,
    @Body() songDto: SongDto
  ) {
    return await this.libraryService.addSong(userId, songDto);
  }
}
