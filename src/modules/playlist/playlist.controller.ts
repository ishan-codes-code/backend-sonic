import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { GetCurrentUser } from '../../infrastructure/common/decorators/get-current-user.decorator';
import { JwtAuthGuard } from '../../infrastructure/common/guards/jwt-auth.guard';
import { getLocalStreamBaseUrl } from '../../infrastructure/storage/stream-base';
import { CreatePlaylistDto, UpdatePlaylistDto } from './dto/createPlaylist.dto';
import { PlaylistService } from './playlist.service';
import { AddSongToPlaylistDto } from './dto/addSongToPlaylist.dto';

@Controller('playlist')
export class PlaylistController {
  constructor(
    private readonly playlistService: PlaylistService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Per-request API base for local-mode stream URLs. Derived only in local
   * mode so r2 responses never depend on request headers.
   */
  private getApiBaseUrl(req: Request): string | undefined {
    if (this.configService.get<string>('STORAGE_MODE') !== 'local') {
      return undefined;
    }
    try {
      return getLocalStreamBaseUrl(req);
    } catch {
      throw new BadRequestException(
        'Cannot determine the stream URL from this request.',
      );
    }
  }

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

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getPlaylistById(@GetCurrentUser() data, @Param('id') id: string) {
    return await this.playlistService.getPlaylistById(data.id, id);
  }

  @Get(':id/songs')
  @UseGuards(JwtAuthGuard)
  async getPlaylistSongs(
    @GetCurrentUser() data,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-device-id') deviceId: string = 'default-session',
    @Req() req: Request,
  ) {
    return await this.playlistService.getPlaylistWithSongs(
      data.id,
      id,
      deviceId,
      this.getApiBaseUrl(req),
    );
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
    return await this.playlistService.removeSongFromPlaylist(
      data.id,
      id,
      songId,
    );
  }

  @Get('song/:songId')
  @UseGuards(JwtAuthGuard)
  async getPlaylistBySongId(
    @GetCurrentUser() data,
    @Param('songId', ParseUUIDPipe) songId: string,
  ) {
    return await this.playlistService.findUserPlaylistIdsBySong(
      data.id,
      songId,
    );
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  async updatePlaylist(
    @GetCurrentUser() data,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlaylistDto,
  ) {
    const hasData = Object.values(dto).some((value) => value !== undefined);
    if (!hasData) {
      throw new BadRequestException('Nothing to update');
    }
    return await this.playlistService.updatePlaylist(data.id, id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async deletePlaylist(@GetCurrentUser() data, @Param('id') id: string) {
    return await this.playlistService.deletePlaylist(data.id, id);
  }
}
