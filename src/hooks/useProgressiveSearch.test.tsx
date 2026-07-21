import { act, renderHook, waitFor } from '@testing-library/react';

import type { SearchBatchResponse } from '@/lib/search.client';
import type { SearchResult } from '@/lib/types';

import {
  mergeSearchResults,
  useProgressiveSearch,
} from './useProgressiveSearch';

function result(
  id: string,
  overrides: Partial<SearchResult> = {}
): SearchResult {
  return {
    id,
    title: `标题 ${id}`,
    poster: '',
    episodes: [],
    source: 'safe',
    source_name: '安全源',
    year: '2026',
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('useProgressiveSearch', () => {
  test('publishes the first batch without waiting for later pages', async () => {
    const first = deferred<SearchBatchResponse>();
    const fetchBatch = jest.fn().mockReturnValue(first.promise);
    const { result: hook } = renderHook(() =>
      useProgressiveSearch('金瓶梅', fetchBatch)
    );

    expect(hook.current.status).toBe('initial-loading');
    await act(async () => {
      first.resolve({ results: [result('first')], totalPages: 3 });
      await first.promise;
    });

    expect(hook.current.results.map((item) => item.id)).toEqual(['first']);
    expect(hook.current.nextPage).toBe(1);
    expect(hook.current.hasMore).toBe(true);
    expect(hook.current.status).toBe('ready');
    expect(fetchBatch).toHaveBeenCalledTimes(1);
  });

  test('advances through empty batches and ignores duplicate load requests', async () => {
    const pages = new Map<
      number,
      ReturnType<typeof deferred<SearchBatchResponse>>
    >();
    const fetchBatch = jest.fn((_query: string, page: number) => {
      const request = deferred<SearchBatchResponse>();
      pages.set(page, request);
      return request.promise;
    });
    const { result: hook } = renderHook(() =>
      useProgressiveSearch('测试', fetchBatch)
    );

    await waitFor(() => expect(pages.has(0)).toBe(true));
    await act(async () => {
      pages.get(0)?.resolve({ results: [], totalPages: 3 });
      await pages.get(0)?.promise;
    });

    let firstLoad!: Promise<void>;
    let duplicateLoad!: Promise<void>;
    act(() => {
      firstLoad = hook.current.loadNext('auto');
      duplicateLoad = hook.current.loadNext('auto');
    });

    expect(fetchBatch).toHaveBeenCalledTimes(2);
    expect(pages.has(1)).toBe(true);
    await act(async () => {
      pages.get(1)?.resolve({ results: [], totalPages: 3 });
      await Promise.all([firstLoad, duplicateLoad]);
    });

    expect(hook.current.results).toEqual([]);
    expect(hook.current.nextPage).toBe(2);
    expect(hook.current.hasMore).toBe(true);
  });

  test('aborts an old query and ignores its late response', async () => {
    const requests = new Map<
      string,
      ReturnType<typeof deferred<SearchBatchResponse>>
    >();
    const signals = new Map<string, AbortSignal | undefined>();
    const fetchBatch = jest.fn(
      (query: string, _page: number, signal?: AbortSignal) => {
        const request = deferred<SearchBatchResponse>();
        requests.set(query, request);
        signals.set(query, signal);
        return request.promise;
      }
    );
    const { result: hook, rerender } = renderHook(
      ({ query }) => useProgressiveSearch(query, fetchBatch),
      { initialProps: { query: '旧查询' } }
    );

    await waitFor(() => expect(requests.has('旧查询')).toBe(true));
    rerender({ query: '新查询' });
    await waitFor(() => expect(requests.has('新查询')).toBe(true));
    expect(signals.get('旧查询')?.aborted).toBe(true);

    await act(async () => {
      requests.get('旧查询')?.resolve({
        results: [result('old')],
        totalPages: 1,
      });
      requests.get('新查询')?.resolve({
        results: [result('new')],
        totalPages: 1,
      });
      await Promise.all([
        requests.get('旧查询')?.promise,
        requests.get('新查询')?.promise,
      ]);
    });

    expect(hook.current.results.map((item) => item.id)).toEqual(['new']);
  });

  test('retries the initial batch once before succeeding', async () => {
    const fetchBatch = jest
      .fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce({ results: [result('retry-ok')], totalPages: 1 });

    const { result: hook } = renderHook(() =>
      useProgressiveSearch('测试', fetchBatch)
    );

    await waitFor(() => expect(hook.current.status).toBe('exhausted'));
    expect(fetchBatch).toHaveBeenCalledTimes(2);
    expect(hook.current.results.map((item) => item.id)).toEqual(['retry-ok']);
    expect(hook.current.failedPages).toEqual([]);
  });

  test('continues probing later batches after the initial batch fails twice', async () => {
    const fetchBatch = jest.fn(async (_query: string, page: number) => {
      if (page === 0) throw new Error('initial batch failed');
      return { results: [result('later')], totalPages: 2 };
    });
    const { result: hook } = renderHook(() =>
      useProgressiveSearch('测试', fetchBatch)
    );

    await waitFor(() => expect(hook.current.failedPages).toEqual([0]));
    expect(hook.current.hasMore).toBe(true);

    await act(async () => {
      await hook.current.loadNext('auto');
    });

    expect(fetchBatch.mock.calls.map((call) => call[1])).toEqual([0, 0, 1]);
    expect(hook.current.results.map((item) => item.id)).toEqual(['later']);
    expect(hook.current.status).toBe('exhausted');
  });

  test('does not restart the query when the fetcher identity changes', async () => {
    const firstFetcher = jest
      .fn()
      .mockResolvedValue({ results: [result('first')], totalPages: 1 });
    const secondFetcher = jest
      .fn()
      .mockResolvedValue({ results: [result('second')], totalPages: 1 });
    const { result: hook, rerender } = renderHook(
      ({ fetcher }) => useProgressiveSearch('测试', fetcher),
      { initialProps: { fetcher: firstFetcher } }
    );

    await waitFor(() => expect(hook.current.status).toBe('exhausted'));
    rerender({ fetcher: secondFetcher });
    await act(async () => undefined);

    expect(firstFetcher).toHaveBeenCalledTimes(1);
    expect(secondFetcher).not.toHaveBeenCalled();
    expect(hook.current.results.map((item) => item.id)).toEqual(['first']);
  });

  test('hides old results synchronously when the query changes', async () => {
    const nextQuery = deferred<SearchBatchResponse>();
    const fetchBatch = jest.fn((query: string) => {
      if (query === '旧查询') {
        return Promise.resolve({ results: [result('old')], totalPages: 1 });
      }
      return nextQuery.promise;
    });
    const { result: hook, rerender } = renderHook(
      ({ query }) => useProgressiveSearch(query, fetchBatch),
      { initialProps: { query: '旧查询' } }
    );

    await waitFor(() => expect(hook.current.results).toHaveLength(1));
    rerender({ query: '新查询' });

    expect(hook.current.results).toEqual([]);
    expect(hook.current.status).toBe('initial-loading');
  });

  test('skips a twice-failed page and retries it separately later', async () => {
    let pageOneAttempts = 0;
    let allowPageOne = false;
    const fetchBatch = jest.fn(async (_query: string, page: number) => {
      if (page === 0) return { results: [result('first')], totalPages: 3 };
      if (page === 1) {
        pageOneAttempts += 1;
        if (!allowPageOne) throw new Error('page one failed');
        return { results: [result('recovered')], totalPages: 3 };
      }
      return { results: [result('last')], totalPages: 3 };
    });
    const { result: hook } = renderHook(() =>
      useProgressiveSearch('测试', fetchBatch)
    );
    await waitFor(() => expect(hook.current.status).toBe('ready'));

    await act(async () => {
      await hook.current.loadNext('append');
    });
    expect(pageOneAttempts).toBe(2);
    expect(hook.current.failedPages).toEqual([1]);
    expect(hook.current.nextPage).toBe(2);
    expect(hook.current.status).toBe('ready');

    await act(async () => {
      await hook.current.loadNext('append');
    });
    expect(hook.current.results.map((item) => item.id)).toEqual([
      'first',
      'last',
    ]);
    expect(hook.current.status).toBe('exhausted');

    allowPageOne = true;
    await act(async () => {
      await hook.current.retryFailed();
    });
    expect(hook.current.failedPages).toEqual([]);
    expect(hook.current.results.map((item) => item.id)).toEqual([
      'first',
      'last',
      'recovered',
    ]);
  });
});

describe('mergeSearchResults', () => {
  test('globally sorts automatic-fill results and removes source-id duplicates', () => {
    const existing = [
      result('later', { title: '普通结果', year: '2024' }),
      result('duplicate', { title: '重复结果', year: '2023' }),
    ];
    const incoming = [
      result('exact', { title: '金瓶梅', year: '2020' }),
      result('duplicate', { title: '重复结果副本', year: '2026' }),
    ];

    const merged = mergeSearchResults(existing, incoming, '金瓶梅', 'auto');

    expect(merged.map((item) => item.id)).toEqual([
      'exact',
      'later',
      'duplicate',
    ]);
  });

  test('preserves existing positions while sorting appended results', () => {
    const existing = [result('existing-b'), result('existing-a')];
    const incoming = [
      result('older', { year: '2020' }),
      result('newer', { year: '2026' }),
    ];

    const merged = mergeSearchResults(existing, incoming, '测试', 'append');

    expect(merged.map((item) => item.id)).toEqual([
      'existing-b',
      'existing-a',
      'newer',
      'older',
    ]);
  });
});
