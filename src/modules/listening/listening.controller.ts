import { Body, Controller, Get, Post, Query, UseGuards, Delete, Param } from '@nestjs/common';
import { ListeningService } from './listening.service';
import { JwtAuthGuard } from '../../infrastructure/common/guards/jwt-auth.guard';
import { GetCurrentUser } from '../../infrastructure/common/decorators/get-current-user.decorator';
import { GetHistoryQueryDto, ProgressSyncDto } from './dto/listening.dto';
import { TasteSignalDto } from './dto/taste-signal.dto';

export interface HistoryArtist {
  id: string;
  name: string;
  normalizedName: string;
}

export interface HistorySong {
  id: string;
  trackName: string;
  albumName: string;
  image: string;
  duration: number;
  youtubeId: string;
  artists: HistoryArtist[];
}

export interface ListeningEvent {
  id: string;
  userId: string;
  songId: string;
  playedAt: string;
  durationListenedSeconds: number;
  completed: boolean;
  song: HistorySong;
}

@Controller('listening')
export class ListeningController {
  constructor(private readonly listeningService: ListeningService) { }

  @UseGuards(JwtAuthGuard)
  @Post('progress-sync')
  async progressSync(@GetCurrentUser() user: any, @Body() dto: ProgressSyncDto) {
    return this.listeningService.syncProgress(user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('taste-signal')
  async recordTasteSignal(@GetCurrentUser() user: any, @Body() dto: TasteSignalDto) {
    return this.listeningService.recordTasteSignal(user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('history')
  async getHistory(@GetCurrentUser() user: any, @Query() query: GetHistoryQueryDto): Promise<ListeningEvent[]> {
    const history = await this.listeningService.getUserHistory(
      user.id,
      query.limit ?? 20,
      query.offset ?? 0,
    );

    return history.map((event: any) => ({
      id: event.id,
      userId: event.userId,
      songId: event.songId,
      playedAt: event.playedAt.toISOString(),
      durationListenedSeconds: event.durationListenedSeconds ?? 0,
      completed: event.completed ?? false,
      song: event.song ? {
        id: event.song.id,
        trackName: event.song.trackName,
        albumName: event.song.albumName ?? '',
        image: event.song.image ?? '',
        duration: event.song.duration,
        youtubeId: event.song.youtubeId,
        artists: event.song.artists ? event.song.artists.map((a: any) => ({
          id: a.id,
          name: a.name,
          normalizedName: a.normalizedName,
        })) : [],
      } : null as any,
    }));
  }

  @UseGuards(JwtAuthGuard)
  @Delete('history/:id')
  async deleteHistoryEvent(@GetCurrentUser() user: any, @Param('id') id: string) {
    return this.listeningService.deleteHistoryEvent(user.id, id);
  }
}
