import { validatePublicHttpsUrl } from './source-url';

describe('public HTTPS source URL policy', () => {
  test('accepts and normalizes public HTTPS domain URLs', () => {
    const url = validatePublicHttpsUrl('  https://Example.COM/path?q=1  ');

    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('example.com');
    expect(url.pathname).toBe('/path');
  });

  test.each([
    ['non-HTTPS URLs', 'http://example.com/api', 'HTTPS'],
    ['embedded usernames', 'https://user@example.com/api', '凭据'],
    ['embedded passwords', 'https://user:pass@example.com/api', '凭据'],
    ['localhost', 'https://localhost/api', '公网'],
    ['localhost subdomains', 'https://api.localhost/api', '公网'],
    ['local domains', 'https://media.local/api', '公网'],
    ['IPv4 literals', 'https://8.8.8.8/api', '公网'],
    ['private IPv4 literals', 'https://192.168.1.1/api', '公网'],
    ['alternate IPv4 spellings', 'https://2130706433/api', '公网'],
    ['IPv6 literals', 'https://[2606:4700:4700::1111]/api', '公网'],
    ['IPv6 loopback', 'https://[::1]/api', '公网'],
  ])('rejects %s', (_label, raw, reason) => {
    expect(() => validatePublicHttpsUrl(raw)).toThrow(reason);
  });

  test('rejects malformed and overlong URLs', () => {
    expect(() => validatePublicHttpsUrl('not a url')).toThrow('URL');
    expect(() =>
      validatePublicHttpsUrl('https://example.com/path', 10)
    ).toThrow('长度');
  });
});
