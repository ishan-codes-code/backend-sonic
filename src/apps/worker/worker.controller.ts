import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ProcessJobData } from '../../modules/songs/song-jobs.service';
import { SongProcessorService } from './song-processor/song-processor.service';

@Controller()
export class WorkerController {
  private readonly logger = new Logger(WorkerController.name);

  constructor(
    private readonly songProcessorService: SongProcessorService,
    private readonly configService: ConfigService,
  ) {}

  private validateSecret(secretHeader: string | string[] | undefined) {
    const secret = Array.isArray(secretHeader) ? secretHeader[0] : secretHeader;
    const expected = this.configService.get<string>('WORKER_SECRET');

    if (!secret || secret !== expected) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }
  }

  @Post('process')
  @HttpCode(202)
  processSong(
    @Headers('x-worker-secret') secret: string | string[] | undefined,
    @Body() data: ProcessJobData,
  ) {
    this.validateSecret(secret);

    const status = this.songProcessorService.getStatus(data.youtubeId);
    if (status === 'failed') {
      throw new BadRequestException(
        `This video previously failed processing: ${data.youtubeId}`,
      );
    }

    if (status === 'active') {
      return { status, youtubeId: data.youtubeId };
    }

    if (this.songProcessorService.isBusy(data.youtubeId)) {
      throw new HttpException('Worker busy', HttpStatus.TOO_MANY_REQUESTS);
    }

    void this.songProcessorService.handle(data).catch((error) => {
      this.logger.error(
        `Song processing failed for youtubeId=${data.youtubeId}`,
        error,
      );
    });

    return { status: 'accepted', youtubeId: data.youtubeId };
  }

  @Get('status/:youtubeId')
  getStatus(
    @Headers('x-worker-secret') secret: string | string[] | undefined,
    @Param('youtubeId') youtubeId: string,
  ) {
    this.validateSecret(secret);

    return {
      status: this.songProcessorService.getStatus(youtubeId),
    };
  }
}
