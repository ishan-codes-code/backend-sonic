import {
  getRequiredKeysForMode,
  getStorageMode,
  isKeyConfigured,
  isSetupRequired,
  LOCAL_SETUP_REQUIRED_KEYS,
  SETUP_REQUIRED_KEYS,
  STORAGE_MODES,
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

describe('storage modes', () => {
  it('advertises local and r2 support', () => {
    expect([...STORAGE_MODES].sort()).toEqual(['local', 'r2']);
  });

  it.each([undefined, '   ', ''])(
    'defaults a missing or blank STORAGE_MODE to r2 (%s)',
    (mode) => {
      expect(getStorageMode({ STORAGE_MODE: mode })).toBe('r2');
    },
  );

  it('resolves explicit local and r2 modes', () => {
    expect(getStorageMode({ STORAGE_MODE: 'local' })).toBe('local');
    expect(getStorageMode({ STORAGE_MODE: 'r2' })).toBe('r2');
  });

  it.each(['s3', 'LOCAL', ' local', 'local ', 'filesystem'])(
    'reports an invalid STORAGE_MODE as undefined (%s)',
    (mode) => {
      expect(getStorageMode({ STORAGE_MODE: mode })).toBeUndefined();
    },
  );

  it('returns mode-specific required keys', () => {
    expect(getRequiredKeysForMode('local')).toEqual(
      LOCAL_SETUP_REQUIRED_KEYS,
    );
    expect(getRequiredKeysForMode('r2')).toEqual(SETUP_REQUIRED_KEYS);
  });
});

describe('local setup completeness', () => {
  function localConfig(): SetupConfigValues {
    return {
      STORAGE_MODE: 'local',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      YOUTUBE_API_KEY: 'youtube-key',
      LASTFM_API_KEY: 'lastfm-key',
    };
  }

  it('does not require setup when only local keys are present', () => {
    expect(isSetupRequired(localConfig())).toBe(false);
  });

  it.each([...LOCAL_SETUP_REQUIRED_KEYS])(
    'requires setup when local key %s is missing',
    (missingKey) => {
      const config = localConfig();
      delete config[missingKey];
      expect(isSetupRequired(config)).toBe(true);
    },
  );

  it.each([...LOCAL_SETUP_REQUIRED_KEYS])(
    'requires setup when local key %s is blank',
    (blankKey) => {
      const config = localConfig();
      config[blankKey] = '   ';
      expect(isSetupRequired(config)).toBe(true);
    },
  );

  it('ignores R2 keys, the stream URL, and the playback secret in local mode', () => {
    const config = localConfig();
    config.R2_ACCOUNT_ID = '   ';
    config.R2_ACCESS_KEY = undefined;
    config.WORKER_STREAM_URL = undefined;
    config.JWT_PLAYBACK_SECRET = undefined;
    expect(isSetupRequired(config)).toBe(false);
  });

  it('requires setup for an invalid STORAGE_MODE even when r2 keys are complete', () => {
    expect(
      isSetupRequired({
        STORAGE_MODE: 's3',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        R2_ACCOUNT_ID: 'account-id',
        R2_ACCESS_KEY: 'access-key',
        R2_SECRET_KEY: 'secret-key',
        R2_BUCKET: 'bucket',
        WORKER_STREAM_URL: 'https://worker.example.com',
        JWT_PLAYBACK_SECRET: 'playback-secret',
        YOUTUBE_API_KEY: 'youtube-key',
        LASTFM_API_KEY: 'lastfm-key',
      }),
    ).toBe(true);
  });

  it('keeps r2 requirements unchanged when the mode is explicit', () => {
    const config: SetupConfigValues = {
      STORAGE_MODE: 'r2',
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
    expect(isSetupRequired(config)).toBe(false);
    delete config.WORKER_STREAM_URL;
    expect(isSetupRequired(config)).toBe(true);
  });
});
