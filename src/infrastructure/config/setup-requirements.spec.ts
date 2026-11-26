import {
  isKeyConfigured,
  isSetupRequired,
  SETUP_REQUIRED_KEYS,
  stripTrailingSlash,
  type SetupConfigValues,
} from './setup-requirements';

function completeConfig(): SetupConfigValues {
  return {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    R2_ACCOUNT_ID: 'account-id',
    R2_ACCESS_KEY: 'access-key',
    R2_SECRET_KEY: 'secret-key',
    R2_BUCKET: 'bucket',
    WORKER_STREAM_URL: 'https://worker.example.com',
    JWT_PLAYBACK_SECRET: 'playback-secret',
    YOUTUBE_API_KEY: 'youtube-key',
    LASTFM_API_KEY: 'lastfm-key',
  };
}

describe('setup completeness', () => {
  it('requires setup when only the database is configured', () => {
    expect(isSetupRequired({ DATABASE_URL: 'postgresql://x' })).toBe(true);
  });

  it.each([...SETUP_REQUIRED_KEYS])(
    'requires setup when %s is missing',
    (missingKey) => {
      const config = completeConfig();
      delete config[missingKey];
      expect(isSetupRequired(config)).toBe(true);
    },
  );

  it.each([...SETUP_REQUIRED_KEYS])(
    'requires setup when %s is blank',
    (blankKey) => {
      const config = completeConfig();
      config[blankKey] = '   ';
      expect(isSetupRequired(config)).toBe(true);
    },
  );

  it('requires setup when the stream URL is unset', () => {
    const config = completeConfig();
    config.WORKER_STREAM_URL = undefined;
    expect(isSetupRequired(config)).toBe(true);
  });

  it('does not require setup when all keys are present', () => {
    expect(isSetupRequired(completeConfig())).toBe(false);
  });

  it('accepts CLOUDFLARE_ACCOUNT_ID as the account ID fallback', () => {
    const config = completeConfig();
    delete config.R2_ACCOUNT_ID;
    config.CLOUDFLARE_ACCOUNT_ID = 'legacy-account-id';

    expect(isSetupRequired(config)).toBe(false);
    expect(isKeyConfigured(config, 'R2_ACCOUNT_ID')).toBe(true);
  });

  it('reports configured per key including the playback secret', () => {
    const config = completeConfig();

    expect(isKeyConfigured(config, 'JWT_PLAYBACK_SECRET')).toBe(true);
    expect(isKeyConfigured({}, 'JWT_PLAYBACK_SECRET')).toBe(false);
    expect(
      isKeyConfigured({ JWT_PLAYBACK_SECRET: '  ' }, 'JWT_PLAYBACK_SECRET'),
    ).toBe(false);
  });

  it('strips trailing slashes from stream URLs', () => {
    expect(stripTrailingSlash('https://worker.example.com/')).toBe(
      'https://worker.example.com',
    );
    expect(stripTrailingSlash('https://worker.example.com///')).toBe(
      'https://worker.example.com',
    );
    expect(stripTrailingSlash('https://worker.example.com')).toBe(
      'https://worker.example.com',
    );
    expect(stripTrailingSlash(undefined)).toBeUndefined();
  });
});
