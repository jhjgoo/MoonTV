import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { getStorage } from '@/lib/db';
import { fetchTextWithLimits } from '@/lib/source-fetch';
import { parseSourceSubscription } from '@/lib/source-subscription';

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
jest.mock('@/lib/db', () => ({ getStorage: jest.fn() }));
jest.mock('@/lib/source-fetch', () => ({ fetchTextWithLimits: jest.fn() }));
jest.mock('@/lib/source-subscription', () => ({
  parseSourceSubscription: jest.fn(),
}));

const mockAuth = getAuthInfoFromCookie as jest.MockedFunction<
  typeof getAuthInfoFromCookie
>;
const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>;
const mockGetStorage = getStorage as jest.MockedFunction<typeof getStorage>;
const mockFetchText = fetchTextWithLimits as jest.MockedFunction<
  typeof fetchTextWithLimits
>;
const mockParse = parseSourceSubscription as jest.MockedFunction<
  typeof parseSourceSubscription
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
        key: 'existing',
        name: 'Existing',
        api: 'https://example.com/api',
        adult: false,
        from: 'custom' as const,
        disabled: false,
      },
    ],
    CustomCategories: [],
  };
}

function createRequest(url = 'https://subscription.example.com/full') {
  return {
    json: async () => ({ url }),
  } as never;
}

describe('POST /api/admin/source/subscription', () => {
  const setAdminConfig = jest.fn();
  let consoleError: jest.SpyInstance;

  beforeAll(() => {
    consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'd1';
    process.env.USERNAME = 'owner';
    mockAuth.mockReturnValue({ username: 'owner' } as never);
    mockGetConfig.mockResolvedValue(createConfig());
    mockGetStorage.mockReturnValue({ setAdminConfig } as never);
    mockFetchText.mockResolvedValue('encoded subscription');
    mockParse.mockReturnValue({
      sources: [],
      added: 0,
      skipped: 0,
      failed: 0,
      skippedItems: [],
      failedItems: [],
    });
  });

  afterAll(() => {
    consoleError.mockRestore();
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
    expect(mockFetchText).not.toHaveBeenCalled();
  });

  test('rejects non-admin users', async () => {
    mockAuth.mockReturnValue({ username: 'member' } as never);

    const response = await POST(createRequest());

    expect(response.status).toBe(401);
    expect(mockFetchText).not.toHaveBeenCalled();
  });

  test.each([
    ['owner', 'owner', 'user'],
    ['administrator', 'member', 'admin'],
  ] as const)(
    'allows an authenticated %s to import',
    async (_label, username, role) => {
      const config = createConfig(role);
      mockAuth.mockReturnValue({ username } as never);
      mockGetConfig.mockResolvedValue(config);
      mockParse.mockReturnValue({
        sources: [
          {
            key: 'new-source',
            name: 'New source',
            api: 'https://new.example.com/api',
            adult: false,
            from: 'custom',
            disabled: false,
          },
        ],
        added: 1,
        skipped: 1,
        failed: 2,
        skippedItems: [{ key: 'existing', reason: 'duplicate' }],
        failedItems: [{ key: 'bad', reason: '名称不能为空' }],
      });

      const response = await POST(createRequest());

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        added: 1,
        skipped: 1,
        failed: 2,
      });
      expect(mockFetchText).toHaveBeenCalledWith(
        'https://subscription.example.com/full',
        { maxBytes: 1024 * 1024 }
      );
      expect(mockParse).toHaveBeenCalledWith(
        'encoded subscription',
        new Set(['existing']),
        1
      );
      expect(config.SourceConfig.map((source) => source.key)).toEqual([
        'existing',
        'new-source',
      ]);
      expect(setAdminConfig).toHaveBeenCalledTimes(1);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
  );

  test('does not persist when the subscription adds no sources', async () => {
    const response = await POST(createRequest());

    expect(response.status).toBe(200);
    expect(setAdminConfig).not.toHaveBeenCalled();
  });

  test.each(['fetch', 'parse'])(
    '%s failure does not persist changes',
    async (stage) => {
      if (stage === 'fetch') {
        mockFetchText.mockRejectedValue(new Error('upstream failed'));
      } else {
        mockParse.mockImplementation(() => {
          throw new Error('invalid subscription');
        });
      }

      const response = await POST(createRequest());

      expect(response.status).toBe(400);
      expect(setAdminConfig).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toEqual({ error: '订阅导入失败' });
    }
  );
});
