import type { NextRequest } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';

export {
  ADULT_ACCESS_DENIED_MESSAGE,
  assertSourceAccessible,
  canAccessSource,
  filterAccessibleSources,
  normalizeAdultAccess,
} from './source-access-core';

export async function getCurrentAdultAccess(
  request: NextRequest
): Promise<boolean> {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return false;
  }

  const config = await getConfig();
  const user = config.UserConfig.Users.find(
    (entry) => entry.username === authInfo.username
  );
  return user?.adult === true;
}
