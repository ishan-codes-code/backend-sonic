import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuthUsersService } from './auth-users.service';
import { AuthSessionsService } from './auth-sessions.service';
import { PlaylistModule } from '../playlist/playlist.module';

@Module({
  imports: [
    ConfigModule,
    PassportModule,
    PlaylistModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        // We do not specify secret here because we use different secrets for access/refresh in signAsync
        // We sign them explicitly in auth.service, but for JwtAuthGuard we need default module setup
        secret: configService.get<string>('jwt.accessSecret'),
        signOptions: {
          expiresIn: configService.get<string>('jwt.accessExpiresIn') as any,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthUsersService, AuthSessionsService, JwtStrategy],
  exports: [AuthService, AuthUsersService, AuthSessionsService],
})
export class AuthModule {}
