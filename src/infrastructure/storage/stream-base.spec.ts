import { getLocalStreamBaseUrl, isValidStreamHost } from './stream-base';

describe('stream base derivation', () => {
  it('uses the direct host and connection protocol', () => {
    expect(
      getLocalStreamBaseUrl({
        headers: { host: '192.168.1.5:3000' },
        protocol: 'http',
      }),
    ).toBe('http://192.168.1.5:3000');
  });

  it('keeps an https direct connection', () => {
    expect(
      getLocalStreamBaseUrl({
        headers: { host: 'sonic.example.com' },
        protocol: 'https',
      }),
    ).toBe('https://sonic.example.com');
  });

  it('handles proxy https through X-Forwarded-Proto', () => {
    expect(
      getLocalStreamBaseUrl({
        headers: {
          host: 'tunnel.example.com',
          'x-forwarded-proto': 'https',
        },
        protocol: 'http',
      }),
    ).toBe('https://tunnel.example.com');
  });

  it('prefers X-Forwarded-Host for tunneled requests', () => {
    expect(
      getLocalStreamBaseUrl({
        headers: {
          host: '127.0.0.1:3000',
          'x-forwarded-host': 'public.tunnel.io',
          'x-forwarded-proto': 'https',
        },
        protocol: 'http',
      }),
    ).toBe('https://public.tunnel.io');
  });

  it('takes the first entry of forwarded lists', () => {
    expect(
      getLocalStreamBaseUrl({
        headers: {
          host: 'internal:3000',
          'x-forwarded-host': 'edge.example.com, internal:3000',
          'x-forwarded-proto': 'https, http',
        },
        protocol: 'http',
      }),
    ).toBe('https://edge.example.com');
  });

  it('falls back to the direct protocol for garbage forwarded proto', () => {
    expect(
      getLocalStreamBaseUrl({
        headers: {
          host: '192.168.1.5:3000',
          'x-forwarded-proto': 'gopher',
        },
        protocol: 'http',
      }),
    ).toBe('http://192.168.1.5:3000');
  });

  it('supports bracketed IPv6 hosts', () => {
    expect(
      getLocalStreamBaseUrl({
        headers: { host: '[fd00::1]:3000' },
        protocol: 'http',
      }),
    ).toBe('http://[fd00::1]:3000');
  });

  it.each([
    ['missing host', {}, 'http'],
    ['blank host', { host: '  ' }, 'http'],
    ['credentials', { host: 'evil.com@internal:3000' }, 'http'],
    ['path', { host: 'example.com/stream' }, 'http'],
    ['whitespace', { host: 'exam ple.com' }, 'http'],
    ['bad port', { host: 'example.com:99999' }, 'http'],
    ['zero port', { host: 'example.com:0' }, 'http'],
    ['unbalanced ipv6', { host: '[::1' }, 'http'],
    [
      'evil forwarded host',
      { host: 'ok.example.com', 'x-forwarded-host': 'evil.com@x' },
      'http',
    ],
  ])('rejects an unsafe host (%s)', (_label, headers, protocol) => {
    expect(() => getLocalStreamBaseUrl({ headers, protocol })).toThrow(
      /safe stream base URL/,
    );
  });

  it('never invents localhost', () => {
    // Localhost appears only when the client itself used it.
    expect(
      getLocalStreamBaseUrl({
        headers: { host: '127.0.0.1:3000' },
        protocol: 'http',
      }),
    ).toBe('http://127.0.0.1:3000');
    expect(
      getLocalStreamBaseUrl({
        headers: { host: 'phone-lan:3000' },
        protocol: 'http',
      }),
    ).not.toContain('localhost');
  });
});

describe('stream host validation', () => {
  it.each([
    'example.com',
    'example.com:3000',
    '192.168.1.5:3000',
    '10.0.0.2',
    '[::1]:3000',
    'a'.repeat(63) + '.com',
  ])('accepts %s', (host) => {
    expect(isValidStreamHost(host)).toBe(true);
  });

  it.each([
    '',
    'example.com:0',
    'example.com:65536',
    'example.com:abc',
    'example.com/path',
    'user@example.com',
    'exam ple.com',
    'example.com?x=1',
    '[::1',
    '::1',
    'a'.repeat(300),
  ])('rejects %s', (host) => {
    expect(isValidStreamHost(host)).toBe(false);
  });
});
