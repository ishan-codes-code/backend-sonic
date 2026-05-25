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
import type { ProcessJobData } from '../../modules/song/song-jobs.service';
import { SongProcessorService } from './song-processor/song-processor.service';

@Controller()
export class WorkerController {
  private readonly logger = new Logger(WorkerController.name);

  constructor(
    private readonly songProcessorService: SongProcessorService,
    private readonly configService: ConfigService,
  ) { }

  private validateSecret(secretHeader: string | string[] | undefined) {
    const secret = Array.isArray(secretHeader) ? secretHeader[0] : secretHeader;
    const expected = this.configService.get<string>('WORKER_SECRET');

    if (!secret || secret !== expected) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }
  }

  @Post('process')
  @HttpCode(202)
  async processSong(
    @Headers('x-worker-secret') secret: string | string[] | undefined,
    @Body() data: ProcessJobData,
  ) {
    this.validateSecret(secret);

    const existingStatus = this.songProcessorService.getQueueStatus(data.youtubeId);
    if (existingStatus.status === 'failed') {
      throw new BadRequestException(
        `This video previously failed processing: ${data.youtubeId}`,
      );
    }

    if (existingStatus.status === 'active') {
      return { status: 'active', youtubeId: data.youtubeId };
    }

    const res = await this.songProcessorService.handle(data);
    if (res.status === 'waiting') {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Worker waiting',
          retryAfter: res.retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return { status: 'active', youtubeId: data.youtubeId };
  }

  @Get('status/:youtubeId')
  getStatus(
    @Headers('x-worker-secret') secret: string | string[] | undefined,
    @Param('youtubeId') youtubeId: string,
  ) {
    this.validateSecret(secret);

    return this.songProcessorService.getQueueStatus(youtubeId);
  }
}
