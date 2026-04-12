import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as schema from './schema';

export const DRIZZLE_PROVIDER = 'DRIZZLE_PROVIDER';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: DRIZZLE_PROVIDER,
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const connectionString = configService.get<string>('database.url');
        if (!connectionString) throw new Error('DATABASE_URL is missing');

        const useWs = process.env.USE_WS_DB === 'true'; // ← toggle via env

        if (useWs) {
          console.log("running ws")
          // Worker on EC2/Docker — use WebSocket
          const { neonConfig, Pool } = await import('@neondatabase/serverless');
          const { drizzle } = await import('drizzle-orm/neon-serverless');
          const ws = await import('ws');
          neonConfig.webSocketConstructor = ws.default;
          const pool = new Pool({ connectionString });
          return drizzle(pool, { schema });
        } else {
          // API on Render — use HTTP (lightweight, serverless-friendly)
          const { neon } = await import('@neondatabase/serverless');
          const { drizzle } = await import('drizzle-orm/neon-http');
          const sql = neon(connectionString);
          return drizzle(sql, { schema });
        }
      },
    },
  ],
  exports: [DRIZZLE_PROVIDER],
})
export class DatabaseModule { }