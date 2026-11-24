import { Injectable } from '@nestjs/common';
import type { WorkerRuntimeState } from './worker-runtime';

@Injectable()
export class WorkerHealthService {
  private currentState: WorkerRuntimeState = 'waiting-for-config';

  setState(state: WorkerRuntimeState): void {
    this.currentState = state;
  }

  getState(): WorkerRuntimeState {
    return this.currentState;
  }
}
