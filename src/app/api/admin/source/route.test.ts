import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { getStorage } from '@/lib/db';

import { POST } from './route';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (
      body: unknown,
      init: { status?: number; headers?: object } = {}
    ) => ({
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

function createConfig() {
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
    UserConfig: { AllowRegister: false, Users: [] },
    SourceConfig: [],
    CustomCategories: [],
  };
}

describe('POST /api/admin/source add adult metadata', () => {
  const setAdminConfig = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'd1';
    process.env.USERNAME = 'owner';
    mockAuth.mockReturnValue({ username: 'owner' } as never);
    mockGetStorage.mockReturnValue({ setAdminConfig } as never);
  });

  afterAll(() => {
    delete process.env.NEXT_PUBLIC_STORAGE_TYPE;
    delete process.env.USERNAME;
  });

  test.each([
    [true, true],
    [false, false],
    ['true', false],
    [1, false],
    [null, false],
    [undefined, false],
  ])('stores adult %p as %p', async (adult, expected) => {
    const config = createConfig();
    mockGetConfig.mockResolvedValue(config);
    const request = {
      json: async () => ({
        action: 'add',
        key: 'demo',
        name: ' Demo ',
        api: ' https://example.com/api ',
        adult,
      }),
    } as never;

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(config.SourceConfig).toEqual([
      expect.objectContaining({
        key: 'demo',
        name: 'Demo',
        api: 'https://example.com/api',
        adult: expected,
        from: 'custom',
        disabled: false,
      }),
    ]);
    expect(setAdminConfig).toHaveBeenCalledTimes(1);
  });
});
