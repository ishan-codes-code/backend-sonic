import { Controller, Get, Inject, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { sql, type SQL } from 'drizzle-orm';
import { DRIZZLE_PROVIDER } from '../../infrastructure/database/database.constants';
import {
  isSetupRequired,
  STORAGE_MODES,
} from '../../infrastructure/config/setup-requirements';
import {
  API_VERSION,
  getPackageVersion,
  MIN_APP_VERSION,
} from '../../shared/constants';

interface HealthDatabase {
  execute(query: SQL): Promise<unknown>;
}

/**
 * Database probe budget. Must stay below 8000ms: the app's setup polling
 * gives up on each attempt after 8s.
 */
export const API_DATABASE_HEALTH_TIMEOUT_MS = 6000;

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

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
      STORAGE_MODE: this.configService.get<string>('STORAGE_MODE'),
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
              API_DATABASE_HEALTH_TIMEOUT_MS,
            );
          }),
        ]);
        db = 'ok';
      } catch (error) {
        db = 'down';
        this.logger.warn(
          `Database health check failed: ${this.safeReason(error)}`,
        );
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }

    const storageMode = this.configService.get<string>('STORAGE_MODE');
    const hasR2Credentials =
      this.configService.get<string>('r2.accountId') &&
      this.configService.get<string>('r2.accessKey') &&
      this.configService.get<string>('r2.secretKey') &&
      this.configService.get<string>('r2.bucket');

    return {
      app: 'sonic-backend',
      version: getPackageVersion(),
      apiVersion: API_VERSION,
      minAppVersion: MIN_APP_VERSION,
      setupRequired,
      db,
      features: {
        storage:
          storageMode === 'local'
            ? 'local'
            : hasR2Credentials
              ? 'r2'
              : 'none',
        // Storage modes this backend supports. Older backends omit this
        // field, so the app must treat a missing field as "r2 only".
        storageModes: [...STORAGE_MODES],
      },
    };
  }

  /**
   * Short failure reason including the underlying cause when present.
   * Never contains secrets: database URLs are redacted, and only the
   * error/cause messages are used.
   */
  private safeReason(error: unknown): string {
    const parts: string[] = [];
    if (error instanceof Error && error.message) {
      parts.push(error.message);
    } else {
      parts.push(String(error));
    }
    const cause = (error as { cause?: unknown } | null)?.cause;
    if (cause instanceof Error && cause.message) {
      parts.push(`caused by: ${cause.message}`);
    } else if (cause !== undefined && cause !== null) {
      parts.push(`caused by: ${String(cause)}`);
    }
    return parts
      .join(' ')
      .replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgres://***');
  }
}
