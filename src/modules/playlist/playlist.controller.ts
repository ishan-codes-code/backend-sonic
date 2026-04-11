import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { GetCurrentUser } from 'src/infrastructure/common/decorators/get-current-user.decorator';
import { JwtAuthGuard } from 'src/infrastructure/common/guards/jwt-auth.guard';
import { CreatePlaylistDto } from './dto/createPlaylist.dto';
import { PlaylistService } from './playlist.service';
import { AddSongToPlaylistDto } from './dto/addSongToPlaylist.dto';

@Controller('playlist')
export class PlaylistController {
  constructor(private readonly playlistService: PlaylistService) { }

  @Post('create')
  @UseGuards(JwtAuthGuard)
  async addPlaylist(@GetCurrentUser() data, @Body() dto: CreatePlaylistDto) {
    return await this.playlistService.addPlaylist(data.id, dto);
  }

  @Get('getAll')
  @UseGuards(JwtAuthGuard)
  async getUserPlaylists(@GetCurrentUser() data) {
    return await this.playlistService.getUserPlaylists(data.id);
  }

  @Get(':id/songs')
  @UseGuards(JwtAuthGuard)
  async getPlaylistSongs(@GetCurrentUser() data, @Param('id') id: string) {
    return await this.playlistService.getPlaylistSongs(data.id, id);
  }

  @Post('song/add')
  @UseGuards(JwtAuthGuard)
  async addSongToPlaylist(
    @GetCurrentUser() data,
    @Body() dto: AddSongToPlaylistDto,
  ) {
    return await this.playlistService.addSongToPlaylist(data.id, dto);
  }

  @Delete(':id/song/:songId')
  @UseGuards(JwtAuthGuard)
  async removeSongFromPlaylist(
    @GetCurrentUser() data,
    @Param('id') id: string,
    @Param('songId') songId: string,
  ) {
    return await this.playlistService.removeSongFromPlaylist(data.id, id, songId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async deletePlaylist(@GetCurrentUser() data, @Param('id') id: string) {
    return await this.playlistService.deletePlaylist(data.id, id);
  }
}
