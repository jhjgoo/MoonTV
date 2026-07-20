import { getCacheTime, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { getCurrentAdultAccess } from '@/lib/source-access';

import { GET } from './route';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (
      body: unknown,
      init: { status?: number; headers?: HeadersInit } = {}
    ) => ({
      status: init.status || 200,
      headers: init.headers,
      json: async () => body,
    }),
  },
}));
jest.mock('@/lib/config', () => ({ getConfig: jest.fn(), getCacheTime: jest.fn() }));
jest.mock('@/lib/downstream', () => ({ searchFromApi: jest.fn() }));
jest.mock('@/lib/source-access', () => ({
  filterAccessibleSources: jest.requireActual('@/lib/source-access')
    .filterAccessibleSources,
  getCurrentAdultAccess: jest.fn(),
}));

const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>;
const mockGetCacheTime = getCacheTime as jest.MockedFunction<typeof getCacheTime>;
const mockSearch = searchFromApi as jest.MockedFunction<typeof searchFromApi>;
const mockAdultAccess = getCurrentAdultAccess as jest.MockedFunction<
  typeof getCurrentAdultAccess
>;

describe('GET /api/search', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCacheTime.mockResolvedValue(7200);
    mockGetConfig.mockResolvedValue({
      SiteConfig: { DisableYellowFilter: true },
      SourceConfig: [
        { key: 'safe', name: '安全源', api: 'https://safe.example', adult: false },
        { key: 'adult', name: '成人源', api: 'https://adult.example', adult: true },
      ],
    } as never);
    mockSearch.mockResolvedValue([]);
  });

  test('does not query adult sources for users without adult access', async () => {
    mockAdultAccess.mockResolvedValue(false);

    await GET({ url: 'https://moontv.test/api/search?q=test' } as Request);

    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'safe' }),
      'test'
    );
  });

  test('does not allow permission-filtered results to be shared from cache', async () => {
    mockAdultAccess.mockResolvedValue(false);

    const response = await GET({
      url: 'https://moontv.test/api/search?q=test',
    } as Request);

    expect(response.headers).toEqual(
      expect.objectContaining({ 'Cache-Control': 'no-store' })
    );
  });
});
