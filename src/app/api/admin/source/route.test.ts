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

describe('POST /api/admin/source', () => {
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

  test('updates a custom source in place and preserves its identity', async () => {
    const config = {
      ...createConfig(),
      SourceConfig: [
        {
          key: 'before',
          name: 'Before',
          api: 'https://before.example.com/api',
          adult: false,
          from: 'custom' as const,
          disabled: false,
        },
        {
          key: 'target',
          name: 'Target',
          api: 'https://target.example.com/api',
          detail: 'https://target.example.com/detail',
          adult: false,
          from: 'custom' as const,
          disabled: false,
        },
        {
          key: 'after',
          name: 'After',
          api: 'https://after.example.com/api',
          adult: false,
          from: 'config' as const,
          disabled: false,
        },
      ],
    };
    mockGetConfig.mockResolvedValue(config);
    const request = {
      json: async () => ({
        action: 'update',
        key: 'target',
        name: ' Updated ',
        api: ' https://updated.example.com/api ',
        detail: ' ',
        adult: true,
        disabled: true,
      }),
    } as never;

    const response = await POST(request);
    const persistedConfig = setAdminConfig.mock.calls[0][0] as typeof config;

    expect(response.status).toBe(200);
    expect(persistedConfig.SourceConfig.map((source) => source.key)).toEqual([
      'before',
      'target',
      'after',
    ]);
    expect(persistedConfig.SourceConfig[1]).toEqual({
      key: 'target',
      name: 'Updated',
      api: 'https://updated.example.com/api',
      detail: undefined,
      adult: true,
      from: 'custom',
      disabled: true,
    });
    expect(config.SourceConfig[1]).toEqual(persistedConfig.SourceConfig[1]);
    expect(setAdminConfig).toHaveBeenCalledTimes(1);
  });

  test('rejects updates to built-in sources', async () => {
    const config = {
      ...createConfig(),
      SourceConfig: [
        {
          key: 'built-in',
          name: 'Built in',
          api: 'https://built-in.example.com/api',
          adult: false,
          from: 'config' as const,
          disabled: false,
        },
      ],
    };
    mockGetConfig.mockResolvedValue(config);
    const request = {
      json: async () => ({
        action: 'update',
        key: 'built-in',
        name: 'Changed',
        api: 'https://changed.example.com/api',
        adult: false,
        disabled: false,
      }),
    } as never;

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: '该源不可编辑',
    });
    expect(setAdminConfig).not.toHaveBeenCalled();
  });

  test('returns 404 when the source key does not exist', async () => {
    const config = createConfig();
    mockGetConfig.mockResolvedValue(config);
    const request = {
      json: async () => ({
        action: 'update',
        key: 'missing',
        name: 'Missing',
        api: 'https://missing.example.com/api',
        adult: false,
        disabled: false,
      }),
    } as never;

    const response = await POST(request);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: '源不存在' });
    expect(setAdminConfig).not.toHaveBeenCalled();
  });

  test.each([
    ['name', '   ', 'https://example.com/api'],
    ['api', 'Example', '   '],
  ])('rejects a blank %s', async (_field, name, api) => {
    const config = {
      ...createConfig(),
      SourceConfig: [
        {
          key: 'custom',
          name: 'Custom',
          api: 'https://custom.example.com/api',
          adult: false,
          from: 'custom' as const,
          disabled: false,
        },
      ],
    };
    mockGetConfig.mockResolvedValue(config);
    const request = {
      json: async () => ({
        action: 'update',
        key: 'custom',
        name,
        api,
        adult: false,
        disabled: false,
      }),
    } as never;

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: '缺少必要参数',
    });
    expect(setAdminConfig).not.toHaveBeenCalled();
  });

  test('normalizes non-boolean update metadata to false', async () => {
    const config = {
      ...createConfig(),
      SourceConfig: [
        {
          key: 'custom',
          name: 'Custom',
          api: 'https://custom.example.com/api',
          adult: true,
          from: 'custom' as const,
          disabled: true,
        },
      ],
    };
    mockGetConfig.mockResolvedValue(config);
    const request = {
      json: async () => ({
        action: 'update',
        key: 'custom',
        name: 'Custom',
        api: 'https://custom.example.com/api',
        adult: 'true',
        disabled: 1,
      }),
    } as never;

    const response = await POST(request);
    const persistedConfig = setAdminConfig.mock.calls[0][0] as typeof config;

    expect(response.status).toBe(200);
    expect(persistedConfig.SourceConfig[0]).toEqual(
      expect.objectContaining({ adult: false, disabled: false })
    );
  });

  test('does not mutate cached config when persistence fails', async () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const originalSource = {
      key: 'custom',
      name: 'Original',
      api: 'https://original.example.com/api',
      adult: false,
      from: 'custom' as const,
      disabled: false,
    };
    const config = {
      ...createConfig(),
      SourceConfig: [originalSource],
    };
    mockGetConfig.mockResolvedValue(config);
    setAdminConfig.mockRejectedValueOnce(new Error('storage unavailable'));
    const request = {
      json: async () => ({
        action: 'update',
        key: 'custom',
        name: 'Updated',
        api: 'https://updated.example.com/api',
        adult: true,
        disabled: true,
      }),
    } as never;

    const response = await POST(request);

    expect(response.status).toBe(500);
    expect(config.SourceConfig).toEqual([originalSource]);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  test('allows an administrator to update a custom source', async () => {
    mockAuth.mockReturnValue({ username: 'admin-user' } as never);
    const config = {
      ...createConfig(),
      UserConfig: {
        AllowRegister: false,
        Users: [
          {
            username: 'admin-user',
            role: 'admin' as const,
            banned: false,
          },
        ],
      },
      SourceConfig: [
        {
          key: 'custom',
          name: 'Custom',
          api: 'https://custom.example.com/api',
          adult: false,
          from: 'custom' as const,
          disabled: false,
        },
      ],
    };
    mockGetConfig.mockResolvedValue(config);
    const request = {
      json: async () => ({
        action: 'update',
        key: 'custom',
        name: 'Updated by admin',
        api: 'https://custom.example.com/api',
        adult: false,
        disabled: false,
      }),
    } as never;

    const response = await POST(request);
    const persistedConfig = setAdminConfig.mock.calls[0][0] as typeof config;

    expect(response.status).toBe(200);
    expect(persistedConfig.SourceConfig[0].name).toBe('Updated by admin');
    expect(setAdminConfig).toHaveBeenCalledTimes(1);
  });

  test('rejects unauthenticated and non-admin users', async () => {
    const request = {
      json: async () => ({
        action: 'update',
        key: 'custom',
        name: 'Updated',
        api: 'https://custom.example.com/api',
        adult: false,
        disabled: false,
      }),
    } as never;

    mockAuth.mockReturnValueOnce(null);
    const unauthenticatedResponse = await POST(request);
    expect(unauthenticatedResponse.status).toBe(401);

    mockAuth.mockReturnValueOnce({ username: 'member' } as never);
    mockGetConfig.mockResolvedValueOnce({
      ...createConfig(),
      UserConfig: {
        AllowRegister: false,
        Users: [{ username: 'member', role: 'user' as const, banned: false }],
      },
    });
    const memberResponse = await POST(request);
    expect(memberResponse.status).toBe(401);
    expect(setAdminConfig).not.toHaveBeenCalled();
  });
});
