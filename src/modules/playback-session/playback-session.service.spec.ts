import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PlaybackSessionModule } from './playback-session.module';
import { PlaybackSessionService } from './playback-session.service';

const PLAYBACK_SECRET = 'configured-playback-secret-for-tests';

describe('PlaybackSessionModule', () => {
  let module: TestingModule | undefined;

  afterEach(async () => {
    if (module) {
      await module.close();
      module = undefined;
    }
  });

  it('starts when the playback secret is missing', async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PlaybackSessionModule,
      ],
    }).compile();

    const app = module.createNestApplication();
    await app.init();
    await app.close();

    expect(module.get(PlaybackSessionService)).toBeDefined();
  });

  it('signs playback tokens with the configured secret', async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              JWT_PLAYBACK_SECRET: PLAYBACK_SECRET,
              JWT_PLAYBACK_EXPIRES_IN: '1h',
            }),
          ],
        }),
        PlaybackSessionModule,
      ],
    }).compile();

    const service = module.get(PlaybackSessionService);
    const token = await service.getOrCreatePlaybackToken('user-1', 'device-1');

    const verifier = new JwtService({ secret: PLAYBACK_SECRET });
    const payload = await verifier.verifyAsync<{
      sub: string;
      deviceId: string;
      scope: string;
    }>(token);

    expect(payload.sub).toBe('user-1');
    expect(payload.deviceId).toBe('device-1');
    expect(payload.scope).toBe('stream');

    const wrongVerifier = new JwtService({ secret: 'wrong-secret' });
    await expect(wrongVerifier.verifyAsync(token)).rejects.toThrow();
  });
});
