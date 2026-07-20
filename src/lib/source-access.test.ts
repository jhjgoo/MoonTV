import type { AdminSource } from './source.types';
import {
  assertSourceAccessible,
  canAccessSource,
  filterAccessibleSources,
  normalizeAdultAccess,
} from './source-access-core';

const safeSource: AdminSource = {
  key: 'safe',
  name: '安全源',
  api: 'https://safe.example/api',
  adult: false,
  from: 'custom',
};

const adultSource: AdminSource = {
  key: 'adult',
  name: '成人源',
  api: 'https://adult.example/api',
  adult: true,
  from: 'custom',
};

describe('source access control', () => {
  test.each([undefined, false, 'true', 1, null, {}, []])(
    'treats non-boolean adult value %p as disabled',
    (adult) => {
      expect(normalizeAdultAccess(adult)).toBe(false);
    }
  );

  test('keeps only non-adult sources for users without access', () => {
    expect(filterAccessibleSources([safeSource, adultSource], false)).toEqual([
      safeSource,
    ]);
  });

  test('allows all sources for users with access', () => {
    expect(filterAccessibleSources([safeSource, adultSource], true)).toEqual([
      safeSource,
      adultSource,
    ]);
  });

  test('rejects direct access to an adult source without permission', () => {
    expect(() => assertSourceAccessible(adultSource, false)).toThrow(
      '未开启成人内容访问权限'
    );
  });

  test('reports whether a source can be accessed without throwing', () => {
    expect(canAccessSource(adultSource, false)).toBe(false);
    expect(canAccessSource(adultSource, true)).toBe(true);
  });
});
