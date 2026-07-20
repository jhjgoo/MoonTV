import {
  TextDecoder as NodeTextDecoder,
  TextEncoder as NodeTextEncoder,
} from 'util';

import { parseSourceSubscription } from './source-subscription';

Object.assign(globalThis, {
  TextDecoder: NodeTextDecoder,
  TextEncoder: NodeTextEncoder,
});

const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const encoder = new NodeTextEncoder();

function encodeBase58Bytes(bytes: Uint8Array): string {
  const digits = [0];
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex++) {
    let carry = bytes[byteIndex];
    for (let index = 0; index < digits.length; index++) {
      carry += digits[index] * 256;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  for (let index = 0; index < bytes.length - 1 && bytes[index] === 0; index++) {
    digits.push(0);
  }
  return digits
    .reverse()
    .map((digit) => BASE58_ALPHABET[digit])
    .join('');
}

function encodeSubscription(value: unknown): string {
  return encodeBase58Bytes(encoder.encode(JSON.stringify(value)));
}

describe('Base58 source subscription parser', () => {
  test('normalizes valid sources and removes extra fields', () => {
    const result = parseSourceSubscription(
      encodeSubscription({
        api_site: {
          demo: {
            name: ' Demo ',
            api: ' https://example.com/api ',
            extra: 'discard me',
          },
          adult: {
            name: 'Adult',
            api: 'https://adult.example.com/api',
            detail: ' https://adult.example.com/detail ',
            adult: true,
          },
        },
      }),
      new Set(),
      0
    );

    expect(result.sources).toEqual([
      {
        key: 'demo',
        name: 'Demo',
        api: 'https://example.com/api',
        detail: undefined,
        adult: false,
        from: 'custom',
        disabled: false,
      },
      {
        key: 'adult',
        name: 'Adult',
        api: 'https://adult.example.com/api',
        detail: 'https://adult.example.com/detail',
        adult: true,
        from: 'custom',
        disabled: false,
      },
    ]);
    expect(result).toMatchObject({ added: 2, skipped: 0, failed: 0 });
  });

  test.each([false, 'true', 1, null, [], {}])(
    'normalizes non-true adult %p to false without failing the item',
    (adult) => {
      const result = parseSourceSubscription(
        encodeSubscription({
          api_site: {
            demo: {
              name: 'Demo',
              api: 'https://example.com/api',
              adult,
            },
          },
        }),
        new Set(),
        0
      );

      expect(result.sources[0].adult).toBe(false);
      expect(result.failed).toBe(0);
    }
  );

  test('separates duplicate and invalid item summaries', () => {
    const result = parseSourceSubscription(
      encodeSubscription({
        api_site: {
          existing: { name: 'Existing', api: 'https://example.com/api' },
          missingName: { api: 'https://example.com/api' },
          unsafeApi: { name: 'Unsafe', api: 'https://127.0.0.1/api' },
          unsafeDetail: {
            name: 'Unsafe detail',
            api: 'https://example.com/api',
            detail: 'http://example.com/detail',
          },
          valid: { name: 'Valid', api: 'https://valid.example.com/api' },
        },
      }),
      new Set(['existing']),
      1
    );

    expect(result.sources.map((source) => source.key)).toEqual(['valid']);
    expect(result).toMatchObject({ added: 1, skipped: 1, failed: 3 });
    expect(result.skippedItems).toEqual([
      { key: 'existing', reason: 'duplicate' },
    ]);
    expect(result.failedItems.map((item) => item.key)).toEqual([
      'missingName',
      'unsafeApi',
      'unsafeDetail',
    ]);
  });

  test('counts every item while capping returned details at 20', () => {
    const invalidEntries = Object.fromEntries(
      Array.from({ length: 25 }, (_, index) => [
        `invalid-${index}`,
        { api: 'https://example.com/api' },
      ])
    );
    const duplicateEntries = Object.fromEntries(
      Array.from({ length: 25 }, (_, index) => [
        `duplicate-${index}`,
        { name: 'Duplicate', api: 'https://example.com/api' },
      ])
    );

    const result = parseSourceSubscription(
      encodeSubscription({
        api_site: { ...invalidEntries, ...duplicateEntries },
      }),
      new Set(Object.keys(duplicateEntries)),
      25
    );

    expect(result).toMatchObject({ added: 0, skipped: 25, failed: 25 });
    expect(result.skippedItems).toHaveLength(20);
    expect(result.failedItems).toHaveLength(20);
  });

  test.each([
    ['', '不能为空'],
    ['0', 'Base58'],
    [encodeBase58Bytes(new Uint8Array([0xff])), 'UTF-8'],
    [encodeBase58Bytes(encoder.encode('{')), 'JSON'],
    [encodeSubscription({ other: {} }), 'api_site'],
    [encodeSubscription({ api_site: [] }), 'api_site'],
  ])('rejects invalid top-level subscription content', (encoded, reason) => {
    expect(() => parseSourceSubscription(encoded, new Set(), 0)).toThrow(
      reason
    );
  });

  test('rejects batch-level source count limits', () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: 501 }, (_, index) => [
        `source-${index}`,
        { name: `Source ${index}`, api: 'https://example.com/api' },
      ])
    );
    expect(() =>
      parseSourceSubscription(
        encodeSubscription({ api_site: tooMany }),
        new Set(),
        0
      )
    ).toThrow('500');

    expect(() =>
      parseSourceSubscription(
        encodeSubscription({
          api_site: {
            oneMore: { name: 'One more', api: 'https://example.com/api' },
          },
        }),
        new Set(),
        1000
      )
    ).toThrow('1000');
  });

  test('reports overlong item fields as individual failures', () => {
    const longKey = 'k'.repeat(129);
    const result = parseSourceSubscription(
      encodeSubscription({
        api_site: {
          [longKey]: { name: 'Demo', api: 'https://example.com/api' },
          longName: {
            name: 'n'.repeat(129),
            api: 'https://example.com/api',
          },
          longApi: {
            name: 'Long API',
            api: `https://example.com/${'a'.repeat(2040)}`,
          },
          longDetail: {
            name: 'Long detail',
            api: 'https://example.com/api',
            detail: `https://example.com/${'a'.repeat(2040)}`,
          },
        },
      }),
      new Set(),
      0
    );

    expect(result).toMatchObject({ added: 0, skipped: 0, failed: 4 });
  });
});
