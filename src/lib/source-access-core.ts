import type { AdminSource } from './source.types';

export const ADULT_ACCESS_DENIED_MESSAGE = '未开启成人内容访问权限';

export function normalizeAdultAccess(adult: unknown): boolean {
  return adult === true;
}

export function filterAccessibleSources<T extends { adult?: unknown }>(
  sources: T[],
  hasAdultAccess: boolean
): T[] {
  return hasAdultAccess
    ? sources
    : sources.filter((source) => !normalizeAdultAccess(source.adult));
}

export function canAccessSource(
  source: Pick<AdminSource, 'adult'> | undefined,
  hasAdultAccess: boolean
): boolean {
  return !source || hasAdultAccess || !normalizeAdultAccess(source.adult);
}

export function assertSourceAccessible(
  source: Pick<AdminSource, 'adult'>,
  hasAdultAccess: boolean
): void {
  if (!canAccessSource(source, hasAdultAccess)) {
    throw new Error(ADULT_ACCESS_DENIED_MESSAGE);
  }
}
