import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import configuration from '../../infrastructure/config/configuration';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { R2Module } from '../../infrastructure/r2/r2.module';
import { AuthModule } from '../../modules/auth/auth.module';
import { SongsApiModule } from '../../modules/songs/songs-api.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PlaylistModule } from '../../modules/playlist/playlist.module';
import { RecommendationModule } from '../../modules/recommendation/recommendation.module';
import { SearchModule } from '../../modules/search/search.module';
import { DiscoveryModule } from '../../modules/discovery/discovery.module';



@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 60,
      },
    ]),
    DatabaseModule,
    R2Module,
    AuthModule,
    SongsApiModule,
    PlaylistModule,
    SearchModule,
    RecommendationModule,
    DiscoveryModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class ApiModule { }
