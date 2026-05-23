import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PlaybackSessionService } from './playback-session.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_PLAYBACK_SECRET', 'fallback_playback_secret_do_not_use_in_prod'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_PLAYBACK_EXPIRES_IN', '24h') as any,
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [PlaybackSessionService],
  exports: [PlaybackSessionService],
})
export class PlaybackSessionModule {}
