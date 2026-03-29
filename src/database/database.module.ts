import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

export const DRIZZLE_PROVIDER = 'DRIZZLE_PROVIDER';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: DRIZZLE_PROVIDER,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const connectionString = configService.get<string>('database.url');
        if (!connectionString) {
          throw new Error('DATABASE_URL is missing');
        }
        const sql = neon(connectionString);
        return drizzle(sql, { schema });
      },
    },
  ],
  exports: [DRIZZLE_PROVIDER],
})
export class DatabaseModule {}
