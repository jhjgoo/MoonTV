import {
  parsePlayerPreference,
  PLAYER_PREFERENCE_KEY,
  readPlayerPreference,
  resetPlayerPreference,
  resolvePlayerPreference,
  writePlayerPreference,
} from './player-preference';

describe('player preference', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('parses only canonical player engine values', () => {
    expect(parsePlayerPreference('artplayer')).toBe('artplayer');
    expect(parsePlayerPreference('vidstack')).toBe('vidstack');
    expect(parsePlayerPreference('dplayer')).toBeNull();
    expect(parsePlayerPreference(null)).toBeNull();
  });

  test('uses ArtPlayer when no stored preference exists', () => {
    expect(readPlayerPreference()).toBe('artplayer');
  });

  test('uses ArtPlayer when the stored preference is a legacy value', () => {
    localStorage.setItem(PLAYER_PREFERENCE_KEY, 'dplayer');

    expect(readPlayerPreference()).toBe('artplayer');
  });

  test.each(['artplayer', 'vidstack'] as const)(
    'reads the stored %s preference',
    (preference) => {
      localStorage.setItem(PLAYER_PREFERENCE_KEY, preference);

      expect(readPlayerPreference()).toBe(preference);
    }
  );

  test('uses a valid URL preference without mutating local storage', () => {
    localStorage.setItem(PLAYER_PREFERENCE_KEY, 'vidstack');
    const setItem = jest.spyOn(Storage.prototype, 'setItem');
    setItem.mockClear();

    expect(resolvePlayerPreference('artplayer')).toBe('artplayer');
    expect(setItem).not.toHaveBeenCalled();
  });

  test('falls back to the valid local preference when the URL value is invalid', () => {
    localStorage.setItem(PLAYER_PREFERENCE_KEY, 'vidstack');

    expect(resolvePlayerPreference('dplayer')).toBe('vidstack');
  });

  test('writes a canonical player preference', () => {
    writePlayerPreference('vidstack');

    expect(localStorage.getItem(PLAYER_PREFERENCE_KEY)).toBe('vidstack');
  });

  test('resets the player preference to ArtPlayer', () => {
    localStorage.setItem(PLAYER_PREFERENCE_KEY, 'vidstack');

    resetPlayerPreference();

    expect(localStorage.getItem(PLAYER_PREFERENCE_KEY)).toBe('artplayer');
  });
});
