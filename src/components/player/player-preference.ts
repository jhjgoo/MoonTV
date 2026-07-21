import type { PlayerEngine } from './player.types';

export const PLAYER_PREFERENCE_KEY = 'preferredPlayer';

const DEFAULT_PLAYER_ENGINE: PlayerEngine = 'artplayer';

export function parsePlayerPreference(
  value: string | null
): PlayerEngine | null {
  if (value === 'artplayer' || value === 'vidstack') {
    return value;
  }

  return null;
}

export function readPlayerPreference(): PlayerEngine {
  if (typeof window === 'undefined') {
    return DEFAULT_PLAYER_ENGINE;
  }

  return (
    parsePlayerPreference(localStorage.getItem(PLAYER_PREFERENCE_KEY)) ??
    DEFAULT_PLAYER_ENGINE
  );
}

export function writePlayerPreference(preference: PlayerEngine): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(PLAYER_PREFERENCE_KEY, preference);
  }
}

export function resetPlayerPreference(): void {
  writePlayerPreference(DEFAULT_PLAYER_ENGINE);
}

export function resolvePlayerPreference(urlValue: string | null): PlayerEngine {
  return parsePlayerPreference(urlValue) ?? readPlayerPreference();
}
