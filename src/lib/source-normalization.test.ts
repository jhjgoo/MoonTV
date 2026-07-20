import {
  normalizeAdminSource,
  normalizeConfigSource,
} from './source-normalization';

describe('source normalization', () => {
  test.each([undefined, false, 'true', 1, null, [], {}])(
    'normalizes adult %p to false',
    (adult) => {
      expect(
        normalizeAdminSource({
          key: ' demo ',
          name: ' Demo ',
          api: ' https://example.com/api ',
          adult,
          from: 'custom',
        })
      ).toMatchObject({
        key: 'demo',
        name: 'Demo',
        api: 'https://example.com/api',
        adult: false,
      });
    }
  );

  test('preserves strict adult true and operational fields', () => {
    expect(
      normalizeAdminSource({
        key: 'demo',
        name: 'Demo',
        api: 'https://example.com/api',
        adult: true,
        from: 'custom',
        disabled: true,
      })
    ).toMatchObject({ adult: true, from: 'custom', disabled: true });
  });

  test('creates config sources with a key and safe defaults', () => {
    expect(
      normalizeConfigSource('demo', {
        name: 'Demo',
        api: 'https://example.com/api',
      })
    ).toEqual({
      key: 'demo',
      name: 'Demo',
      api: 'https://example.com/api',
      detail: undefined,
      adult: false,
      from: 'config',
      disabled: false,
    });
  });
});
