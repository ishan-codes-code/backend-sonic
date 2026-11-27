import { Controller, Get } from '@nestjs/common';
import { loadRuntimeConfig } from '../../infrastructure/config/runtime-config';
import { STORAGE_MODES } from '../../infrastructure/config/setup-requirements';
import {
  API_VERSION,
  getPackageVersion,
  MIN_APP_VERSION,
} from '../../shared/constants';
import { isDatabaseAvailable } from './worker-runtime';
import { WorkerHealthService } from './worker-health.service';

@Controller()
export class WorkerHealthController {
  constructor(private readonly healthService: WorkerHealthService) {}

  @Get('health')
  async getHealth() {
    const config = loadRuntimeConfig({ readOnly: true });
    const setupRequired = !config.DATABASE_URL;
    const state = this.healthService.getState();
    const databaseAvailable = setupRequired
      ? false
      : await isDatabaseAvailable(config, 2000);

    const hasR2Credentials =
      (config.R2_ACCOUNT_ID || config.CLOUDFLARE_ACCOUNT_ID) &&
      config.R2_ACCESS_KEY &&
      config.R2_SECRET_KEY &&
      config.R2_BUCKET;

    return {
      app: 'sonic-backend',
      version: getPackageVersion(),
      apiVersion: API_VERSION,
      minAppVersion: MIN_APP_VERSION,
      setupRequired,
      db: setupRequired ? 'unconfigured' : databaseAvailable ? 'ok' : 'down',
      features: {
        storage:
          config.STORAGE_MODE === 'local'
            ? 'local'
            : hasR2Credentials
              ? 'r2'
              : 'none',
        // Storage modes this backend supports. Older backends omit this
        // field, so the app must treat a missing field as "r2 only".
        storageModes: [...STORAGE_MODES],
      },
      state,
    };
  }
}
