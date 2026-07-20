import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { checkSourceHealth } from '@/lib/source-health';

import { POST } from './route';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (
      body: unknown,
      init: { status?: number; headers?: object } = {}
    ) => ({
      status: init.status || 200,
      headers: {
        get: (name: string) =>
          (init.headers as Record<string, string> | undefined)?.[name] || null,
      },
      json: async () => body,
    }),
  },
}));
jest.mock('@/lib/auth', () => ({ getAuthInfoFromCookie: jest.fn() }));
jest.mock('@/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('@/lib/source-health', () => ({ checkSourceHealth: jest.fn() }));

const mockAuth = getAuthInfoFromCookie as jest.MockedFunction<
  typeof getAuthInfoFromCookie
>;
const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>;
const mockCheckHealth = checkSourceHealth as jest.MockedFunction<
  typeof checkSourceHealth
>;

function createConfig(role: 'user' | 'admin' = 'user') {
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
      Users: [{ username: 'member', role }],
    },
    SourceConfig: [
      {
        key: 'demo',
        name: 'Demo',
        api: 'https://example.com/api',
        adult: false,
        from: 'custom' as const,
        disabled: false,
      },
    ],
    CustomCategories: [],
  };
}

function createRequest(key: unknown = 'demo') {
  return { json: async () => ({ key }) } as never;
}

describe('POST /api/admin/source/check', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'd1';
    process.env.USERNAME = 'owner';
    mockAuth.mockReturnValue({ username: 'owner' } as never);
    mockGetConfig.mockResolvedValue(createConfig());
    mockCheckHealth.mockResolvedValue({
      healthy: true,
      latencyMs: 25,
      message: '接口响应正常',
    });
  });

  afterAll(() => {
    delete process.env.NEXT_PUBLIC_STORAGE_TYPE;
    delete process.env.USERNAME;
  });

  test('rejects localStorage mode before authentication', async () => {
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'localstorage';

    const response = await POST(createRequest());

    expect(response.status).toBe(400);
    expect(mockAuth).not.toHaveBeenCalled();
  });

  test('rejects unauthenticated requests', async () => {
    mockAuth.mockReturnValue(null);

    const response = await POST(createRequest());

    expect(response.status).toBe(401);
    expect(mockCheckHealth).not.toHaveBeenCalled();
  });

  test('rejects non-admin users', async () => {
    mockAuth.mockReturnValue({ username: 'member' } as never);

    const response = await POST(createRequest());

    expect(response.status).toBe(401);
    expect(mockCheckHealth).not.toHaveBeenCalled();
  });

  test('rejects a missing key and an unknown source', async () => {
    const missing = await POST(createRequest(''));
    const unknown = await POST(createRequest('unknown'));

    expect(missing.status).toBe(400);
    expect(unknown.status).toBe(404);
    expect(mockCheckHealth).not.toHaveBeenCalled();
  });

  test.each([
    ['owner', 'owner', 'user'],
    ['administrator', 'member', 'admin'],
  ] as const)(
    'allows an authenticated %s to check a source',
    async (_label, username, role) => {
      const config = createConfig(role);
      const originalSources = JSON.stringify(config.SourceConfig);
      mockAuth.mockReturnValue({ username } as never);
      mockGetConfig.mockResolvedValue(config);

      const response = await POST(createRequest());

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        healthy: true,
        latencyMs: 25,
        message: '接口响应正常',
      });
      expect(mockCheckHealth).toHaveBeenCalledWith(config.SourceConfig[0]);
      expect(JSON.stringify(config.SourceConfig)).toBe(originalSources);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
  );
});
