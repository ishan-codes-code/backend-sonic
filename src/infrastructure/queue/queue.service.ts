import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { SONGS_QUEUE } from './queue.constants';

@Injectable()
export class QueueService {
  constructor(@Inject(SONGS_QUEUE) private readonly songQueue: Queue) {}

  getQueue() {
    return this.songQueue;
  }
}
