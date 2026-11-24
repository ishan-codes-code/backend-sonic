import { Controller, Get, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { sql, type SQL } from 'drizzle-orm';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { DRIZZLE_PROVIDER } from '../../infrastructure/database/database.constants';
import { API_VERSION, MIN_APP_VERSION } from '../../shared/constants';

const packageVersion = (
  JSON.parse(
    readFileSync(resolve(__dirname, '../../../package.json'), 'utf8'),
  ) as { version: string }
).version;

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
    const setupRequired = !databaseUrl;
    let db: 'ok' | 'down' | 'unconfigured' = setupRequired
      ? 'unconfigured'
      : 'down';

    if (!setupRequired && this.database) {
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
      version: packageVersion,
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
