import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { getStorage } from '@/lib/db';

import { POST } from './route';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init: { status?: number } = {}) => ({
      status: init.status || 200,
      json: async () => body,
    }),
  },
}));
jest.mock('@/lib/auth', () => ({ getAuthInfoFromCookie: jest.fn() }));
jest.mock('@/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('@/lib/db', () => ({ getStorage: jest.fn() }));

const mockAuth = getAuthInfoFromCookie as jest.MockedFunction<
  typeof getAuthInfoFromCookie
>;
const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>;
const mockGetStorage = getStorage as jest.MockedFunction<typeof getStorage>;

function config() {
  return {
    SiteConfig: {
      SiteName: 'MoonTV',
      Announcement: '',
      SearchDownstreamMaxPage: 5,
      SiteInterfaceCacheTime: 7200,
      ImageProxy: '',
      DoubanProxy: '',
      DisableYellowFilter: false,
    },
    UserConfig: {
      AllowRegister: false,
      Users: [
        { username: 'owner', role: 'owner' as const, adult: false },
        { username: 'admin', role: 'admin' as const, adult: false },
        { username: 'user', role: 'user' as const, adult: false },
      ],
    },
    SourceConfig: [],
    CustomCategories: [],
  };
}

describe('POST /api/admin/user setAdultAccess', () => {
  const setAdminConfig = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'redis';
    process.env.USERNAME = 'owner';
    mockGetStorage.mockReturnValue({ setAdminConfig } as never);
  });

  afterAll(() => {
    delete process.env.NEXT_PUBLIC_STORAGE_TYPE;
    delete process.env.USERNAME;
  });

  test('allows the owner to change their own adult access', async () => {
    const adminConfig = config();
    mockAuth.mockReturnValue({ username: 'owner' } as never);
    mockGetConfig.mockResolvedValue(adminConfig);

    const response = await POST({
      json: async () => ({
        action: 'setAdultAccess',
        targetUsername: 'owner',
        adult: true,
      }),
    } as never);

    expect(response.status).toBe(200);
    expect(adminConfig.UserConfig.Users[0].adult).toBe(true);
  });

  test('rejects a non-boolean adult access value', async () => {
    mockAuth.mockReturnValue({ username: 'owner' } as never);
    mockGetConfig.mockResolvedValue(config());

    const response = await POST({
      json: async () => ({
        action: 'setAdultAccess',
        targetUsername: 'user',
        adult: 'true',
      }),
    } as never);

    expect(response.status).toBe(400);
  });

  test('allows an admin to change a regular user only', async () => {
    const adminConfig = config();
    mockAuth.mockReturnValue({ username: 'admin' } as never);
    mockGetConfig.mockResolvedValue(adminConfig);

    const allowed = await POST({
      json: async () => ({
        action: 'setAdultAccess',
        targetUsername: 'user',
        adult: true,
      }),
    } as never);
    const denied = await POST({
      json: async () => ({
        action: 'setAdultAccess',
        targetUsername: 'owner',
        adult: true,
      }),
    } as never);

    expect(allowed.status).toBe(200);
    expect(denied.status).toBe(403);
  });
});
