import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Logger, Param, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { SongsService } from './songs.service';
import { JwtAuthGuard } from '../../infrastructure/common/guards/jwt-auth.guard';
import { PlaySongDto, WorkerCallbackDto } from './dto/song.dto';
import { ConfigService } from '@nestjs/config';
import { PlaybackSessionService } from '../playback-session/playback-session.service';
import { GetCurrentUser } from '../../infrastructure/common/decorators/get-current-user.decorator';

@Controller('song')
export class SongsController {
  private readonly logger = new Logger(SongsController.name);

  constructor(
    private readonly songsService: SongsService,
    private readonly configService: ConfigService,
    private readonly playbackSessionService: PlaybackSessionService,
  ) { }

  @UseGuards(JwtAuthGuard)
  @Post('play')
  async playSongResolver(
    @GetCurrentUser() user: any,
    @Headers('x-device-id') deviceId: string = 'default-session',
    @Body() dto: PlaySongDto,
  ) {
    const response = await this.songsService.play(dto);
    if (response.type === 'ready') {
      const playbackToken = await this.playbackSessionService.getOrCreatePlaybackToken(user.id, deviceId);
      return { ...response, playbackToken };
    }
    return response;
  }

  @UseGuards(JwtAuthGuard)
  @Get('job/:jobId')
  async getSongJob(
    @GetCurrentUser() user: any,
    @Headers('x-device-id') deviceId: string = 'default-session',
    @Param('jobId') youtubeId: string,
  ) {
    const status = await this.songsService.getJobStatus(youtubeId);
    if (status.status === 'completed') {
      const playbackToken = await this.playbackSessionService.getOrCreatePlaybackToken(user.id, deviceId);
      return { ...status, playbackToken };
    }
    return status;
  }

  /**
   * POST /song/worker-callback
   *
   * Internal-only endpoint. The Worker POSTs here when a processing job
   * finishes (completed or failed). Protected by the shared WORKER_SECRET
   * header — no JWT guard since this is a service-to-service call.
   */
  @Post('worker-callback')
  @HttpCode(HttpStatus.OK)
  workerCallback(
    @Headers('x-worker-secret') secret: string | undefined,
    @Body() dto: WorkerCallbackDto,
  ) {
    const expected = this.configService.get<string>('WORKER_SECRET');
    if (!secret || secret !== expected) {
      throw new UnauthorizedException('Invalid worker secret');
    }

    this.logger.log(
      `Worker callback received: youtubeId=${dto.youtubeId} status=${dto.status}`,
    );
    this.songsService.handleWorkerCallback(dto);
    return { received: true };
  }

  /**
   * @deprecated
   * GET /song/:id
   *
   * Resolves a stable song ID to a short-lived R2 presigned URL and issues a
   * 302 redirect. The presigned URL is cached server-side for 240 s (TTL < R2
   * expiry of 300 s). We also send a Cache-Control header so well-behaved
   * clients (and CDN edges) can reuse the redirect without hitting this
   * endpoint again for the same window.
   */
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async streamAudio(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    this.logger.log(`Stream request for songId=${id}`);

   const url ='https://google.com';

    // Allow the client to cache the redirect itself for 230 s.
    // Keeping it under 240 s ensures the presigned URL is still valid on use.
    // res.setHeader('Cache-Control', 'private, max-age=230');
    res.redirect(HttpStatus.FOUND, url);
  }
}
