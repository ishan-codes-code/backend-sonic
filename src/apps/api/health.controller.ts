import { Controller, Get, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { sql, type SQL } from 'drizzle-orm';
import { DRIZZLE_PROVIDER } from '../../infrastructure/database/database.constants';
import { isSetupRequired } from '../../infrastructure/config/setup-requirements';
import {
  API_VERSION,
  getPackageVersion,
  MIN_APP_VERSION,
} from '../../shared/constants';

interface HealthDatabase {
  execute(query: SQL): Promise<unknown>;
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly configService: ConfigService,
    @Optional()
    @Inject(DRIZZLE_PROVIDER)
    private readonly database?: HealthDatabase,
  ) {}

  @Get()
  @SkipThrottle()
  async getHealth() {
    const databaseUrl = this.configService.get<string>('database.url');
    const setupRequired = isSetupRequired({
      DATABASE_URL: databaseUrl,
      R2_ACCOUNT_ID: this.configService.get<string>('R2_ACCOUNT_ID'),
      CLOUDFLARE_ACCOUNT_ID: this.configService.get<string>(
        'CLOUDFLARE_ACCOUNT_ID',
      ),
      R2_ACCESS_KEY: this.configService.get<string>('R2_ACCESS_KEY'),
      R2_SECRET_KEY: this.configService.get<string>('R2_SECRET_KEY'),
      R2_BUCKET: this.configService.get<string>('R2_BUCKET'),
      WORKER_STREAM_URL: this.configService.get<string>('WORKER_STREAM_URL'),
      JWT_PLAYBACK_SECRET: this.configService.get<string>(
        'JWT_PLAYBACK_SECRET',
      ),
      YOUTUBE_API_KEY: this.configService.get<string>('YOUTUBE_API_KEY'),
      LASTFM_API_KEY: this.configService.get<string>('LASTFM_API_KEY'),
    });
    const databaseUnconfigured = !databaseUrl;
    let db: 'ok' | 'down' | 'unconfigured' = databaseUnconfigured
      ? 'unconfigured'
      : 'down';

    if (!databaseUnconfigured && this.database) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          this.database.execute(sql`select 1`),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error('Database health check timed out')),
              2000,
            );
          }),
        ]);
        db = 'ok';
      } catch {
        db = 'down';
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }

    return {
      app: 'sonic-backend',
      version: getPackageVersion(),
      apiVersion: API_VERSION,
      minAppVersion: MIN_APP_VERSION,
      setupRequired,
      db,
      features: {
        storage:
          this.configService.get<string>('r2.accountId') &&
          this.configService.get<string>('r2.accessKey') &&
          this.configService.get<string>('r2.secretKey') &&
          this.configService.get<string>('r2.bucket')
            ? 'r2'
            : 'none',
      },
    };
  }
}
