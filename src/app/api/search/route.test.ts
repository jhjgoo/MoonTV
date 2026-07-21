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
jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
  getCacheTime: jest.fn(),
}));
jest.mock('@/lib/downstream', () => ({ searchFromApi: jest.fn() }));
jest.mock('@/lib/source-access', () => ({
  filterAccessibleSources: jest.requireActual('@/lib/source-access')
    .filterAccessibleSources,
  getCurrentAdultAccess: jest.fn(),
}));

const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>;
const mockGetCacheTime = getCacheTime as jest.MockedFunction<
  typeof getCacheTime
>;
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
        {
          key: 'safe',
          name: '安全源',
          api: 'https://safe.example',
          adult: false,
        },
        {
          key: 'adult',
          name: '成人源',
          api: 'https://adult.example',
          adult: true,
        },
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
      'test',
      1
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

  test('queries only one Cloudflare-safe source batch at a time', async () => {
    mockAdultAccess.mockResolvedValue(true);
    mockGetConfig.mockResolvedValue({
      SiteConfig: { SearchDownstreamMaxPage: 5, AdultKeywords: [] },
      SourceConfig: Array.from({ length: 9 }, (_, index) => ({
        key: `source-${index}`,
        name: `视频源 ${index}`,
        api: `https://source-${index}.example`,
        adult: false,
      })),
    } as never);

    const response = await GET({
      url: 'https://moontv.test/api/search?q=test&page=1',
    } as Request);

    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'source-8' }),
      'test',
      5
    );
    await expect(response.json()).resolves.toEqual({
      results: [],
      totalPages: 2,
    });
  });

  test('keeps the source batch bounded when max pages exceeds the budget', async () => {
    mockAdultAccess.mockResolvedValue(true);
    mockGetConfig.mockResolvedValue({
      SiteConfig: { SearchDownstreamMaxPage: 100, AdultKeywords: [] },
      SourceConfig: Array.from({ length: 2 }, (_, index) => ({
        key: `source-${index}`,
        name: `视频源 ${index}`,
        api: `https://source-${index}.example`,
      })),
    } as never);

    const response = await GET({
      url: 'https://moontv.test/api/search?q=test&page=0',
    } as Request);

    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'source-0' }),
      'test',
      40
    );
    await expect(response.json()).resolves.toEqual({
      results: [],
      totalPages: 2,
    });
  });

  test('cannot reach adult sources or adult keyword results through later pages', async () => {
    mockAdultAccess.mockResolvedValue(false);
    mockGetConfig.mockResolvedValue({
      SiteConfig: { SearchDownstreamMaxPage: 40, AdultKeywords: ['金瓶梅'] },
      SourceConfig: [
        { key: 'safe-0', name: '安全源 0', api: 'https://safe-0.example' },
        {
          key: 'adult',
          name: '成人源',
          api: 'https://adult.example',
          adult: true,
        },
        { key: 'safe-1', name: '安全源 1', api: 'https://safe-1.example' },
      ],
    } as never);
    mockSearch.mockResolvedValue([
      { id: 'blocked', title: '金瓶梅', source: 'safe-1' },
    ] as never);

    const response = await GET({
      url: 'https://moontv.test/api/search?q=test&page=1',
    } as Request);

    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'safe-1' }),
      'test',
      40
    );
    expect(mockSearch).not.toHaveBeenCalledWith(
      expect.objectContaining({ key: 'adult' }),
      expect.anything(),
      expect.anything()
    );
    await expect(response.json()).resolves.toEqual({
      results: [],
      totalPages: 2,
    });
  });
});
