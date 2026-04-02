import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { GetCurrentUser } from 'src/infrastructure/common/decorators/get-current-user.decorator';
import { JwtAuthGuard } from 'src/infrastructure/common/guards/jwt-auth.guard';
import { CreatePlaylistDto } from './dto/createPlaylist.dto';
import { PlaylistService } from './playlist.service';
import { SongToPlaylistDto } from './dto/addSongToPlaylisy.dto';

@Controller('playlist')
export class PlaylistController {
  constructor(private readonly playlistServive: PlaylistService) { }

  @Post('create')
  @UseGuards(JwtAuthGuard)
  async addPlaylist(@GetCurrentUser() data, @Body() dto: CreatePlaylistDto) {
    return await this.playlistServive.addPlaylist(data.id, dto);
  }

  @Get('getAll')
  @UseGuards(JwtAuthGuard)
  async getUserPlaylists(@GetCurrentUser() data) {
    return await this.playlistServive.getUserPlaylists(data.id);
  }

  @Get(':id/songs')
  @UseGuards(JwtAuthGuard)
  async getPlaylistSongs(@GetCurrentUser() data, @Param('id') id: string) {
    return await this.playlistServive.getPlaylistSongs(data.id, id);
  }

  @Post('addSong')
  @UseGuards(JwtAuthGuard)
  async addSongToPlaylist(
    @GetCurrentUser() data,
    @Body() dto: SongToPlaylistDto,
  ) {
    return await this.playlistServive.addSongToPlaylist(data.id, dto);
  }
  @Post('removeSong')
  @UseGuards(JwtAuthGuard)
  async removeSongFromPlaylist(
    @GetCurrentUser() data,
    @Body() dto: SongToPlaylistDto,
  ) {
    return await this.playlistServive.removeSongFromPlaylist(data.id, dto);
  }
}
