import {
  fetchAllSearchResults,
  fetchSearchBatch,
  shouldFetchSearchImmediately,
} from './search.client';

describe('fetchSearchBatch', () => {
  test('loads one requested server-side batch', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ id: 'batch-2' }], totalPages: 4 }),
    });

    const batch = await fetchSearchBatch('金瓶梅', 2, fetchImpl as never);

    expect(batch.results[0].id).toBe('batch-2');
    expect(batch.totalPages).toBe(4);
    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/search?q=${encodeURIComponent('金瓶梅')}&page=2`,
      { cache: 'no-store' }
    );
  });

  test('rejects malformed batch responses', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: 'invalid', totalPages: 0 }),
    });

    await expect(
      fetchSearchBatch('测试', 0, fetchImpl as never)
    ).rejects.toThrow('搜索响应格式错误');
  });
});

describe('fetchAllSearchResults', () => {
  test('loads and merges every server-side source batch', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ id: 'first' }], totalPages: 3 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ id: 'second' }], totalPages: 3 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ id: 'third' }], totalPages: 3 }),
      });

    const results = await fetchAllSearchResults('金瓶梅', fetchImpl as never);

    expect(results.map((result) => result.id)).toEqual([
      'first',
      'second',
      'third',
    ]);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      `/api/search?q=${encodeURIComponent('金瓶梅')}&page=0`,
      { cache: 'no-store' }
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      `/api/search?q=${encodeURIComponent('金瓶梅')}&page=1`,
      { cache: 'no-store' }
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      `/api/search?q=${encodeURIComponent('金瓶梅')}&page=2`,
      { cache: 'no-store' }
    );
  });

  test('forwards an abort signal to every batch request', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [], totalPages: 1 }),
    });
    const controller = new AbortController();

    await fetchAllSearchResults('测试', fetchImpl as never, controller.signal);

    expect(fetchImpl).toHaveBeenCalledWith(expect.any(String), {
      cache: 'no-store',
      signal: controller.signal,
    });
  });

  test('limits concurrent server-side batch requests', async () => {
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const fetchImpl = jest.fn().mockImplementation(async (url: string) => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 1));
      activeRequests -= 1;
      return {
        ok: true,
        json: async () => ({
          results: [],
          totalPages: url.endsWith('page=0') ? 8 : 8,
        }),
      };
    });

    await fetchAllSearchResults('测试', fetchImpl as never);

    expect(maxActiveRequests).toBeLessThanOrEqual(3);
    expect(fetchImpl).toHaveBeenCalledTimes(8);
  });
});

describe('shouldFetchSearchImmediately', () => {
  test('only retries immediately when the URL already has the same query', () => {
    expect(shouldFetchSearchImmediately('金瓶梅', '金瓶梅')).toBe(true);
    expect(shouldFetchSearchImmediately('测试', '金瓶梅')).toBe(false);
    expect(shouldFetchSearchImmediately(null, '金瓶梅')).toBe(false);
  });
});
