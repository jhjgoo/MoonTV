import type { NextRequest } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';

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

export function assertSourceAccessible(
  source: Pick<AdminSource, 'adult'>,
  hasAdultAccess: boolean
): void {
  if (normalizeAdultAccess(source.adult) && !hasAdultAccess) {
    throw new Error(ADULT_ACCESS_DENIED_MESSAGE);
  }
}

export async function getCurrentAdultAccess(
  request: NextRequest
): Promise<boolean> {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return false;
  }

  const { getConfig } = await import('@/lib/config');
  const config = await getConfig();
  const user = config.UserConfig.Users.find(
    (entry) => entry.username === authInfo.username
  );
  return normalizeAdultAccess(user?.adult);
}
