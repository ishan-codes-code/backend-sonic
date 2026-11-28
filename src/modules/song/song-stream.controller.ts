import {
  Controller,
  Get,
  Head,
  Headers,
  Logger,
  NotFoundException,
  Param,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { closeSync, createReadStream } from 'fs';
import { SongLocalStreamService } from './song-local-stream.service';

const AUDIO_CONTENT_TYPE = 'audio/mp4';

/**
 * Local-mode audio streaming: GET and HEAD /stream/:youtubeId.
 *
 * The R2 deployment streams from the worker URL instead, so this endpoint
 * answers 404 in any non-local mode. Responses never load the whole file
 * into memory: bytes stream from disk through a bounded read stream.
 * Playback tokens are verified but never logged.
 */
@Controller('stream')
@SkipThrottle()
export class SongStreamController {
  private readonly logger = new Logger(SongStreamController.name);

  constructor(
    private readonly localStream: SongLocalStreamService,
    private readonly configService: ConfigService,
  ) {}

  @Get(':youtubeId')
  async streamAudio(
    @Param('youtubeId') youtubeId: string,
    @Headers('authorization') authorization: string | string[] | undefined,
    @Headers('range') range: string | string[] | undefined,
    @Res() res: Response,
  ): Promise<void> {
    await this.handle(youtubeId, authorization, range, false, res);
  }

  @Head(':youtubeId')
  async streamAudioHead(
    @Param('youtubeId') youtubeId: string,
    @Headers('authorization') authorization: string | string[] | undefined,
    @Headers('range') range: string | string[] | undefined,
    @Res() res: Response,
  ): Promise<void> {
    await this.handle(youtubeId, authorization, range, true, res);
  }

  private async handle(
    youtubeId: string,
    authorization: string | string[] | undefined,
    range: string | string[] | undefined,
    headOnly: boolean,
    res: Response,
  ): Promise<void> {
    const filePath = this.localStream.resolveFilePath(youtubeId);

    if (this.configService.get<string>('storage.mode') !== 'local') {
      throw new NotFoundException('Song file not found.');
    }

    await this.localStream.verifyPlaybackToken(authorization);

    const { fd, size } = this.localStream.openLocalFile(filePath);
    let streamOwnsFd = false;
    try {
      const parsed = this.localStream.parseRange(range, size);

      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', AUDIO_CONTENT_TYPE);

      if (parsed.type === 'unsatisfiable') {
        res.setHeader('Content-Range', `bytes */${size}`);
        res.status(416).end();
        this.logger.debug(
          `Stream ${headOnly ? 'HEAD' : 'GET'} youtubeId=${youtubeId} -> 416`,
        );
        return;
      }

      if (parsed.type === 'range') {
        res.setHeader(
          'Content-Range',
          `bytes ${parsed.start}-${parsed.end}/${size}`,
        );
        res.setHeader('Content-Length', String(parsed.end - parsed.start + 1));
        res.status(206);
      } else {
        res.setHeader('Content-Length', String(size));
        res.status(200);
      }

      if (headOnly) {
        res.end();
        this.logger.debug(
          `Stream HEAD youtubeId=${youtubeId} -> ${res.statusCode}`,
        );
        return;
      }

      const fileStream =
        parsed.type === 'range'
          ? createReadStream(filePath, {
              fd,
              start: parsed.start,
              end: parsed.end,
              autoClose: true,
            })
          : createReadStream(filePath, { fd, autoClose: true });
      fileStream.on('error', () => {
        try {
          res.destroy();
        } catch {
          // The connection is already gone; nothing left to do.
        }
      });
      res.on('close', () => {
        try {
          fileStream.destroy();
        } catch {
          // Already closed; ignore.
        }
      });
      fileStream.pipe(res);
      streamOwnsFd = true;
      this.logger.debug(
        `Stream GET youtubeId=${youtubeId} -> ${res.statusCode}`,
      );
    } finally {
      // The piped read stream owns and closes the fd (autoClose). Every
      // other path closes it here.
      if (!streamOwnsFd) {
        try {
          closeSync(fd);
        } catch {
          // The fd may already be closed; ignore.
        }
      }
    }
  }
}
