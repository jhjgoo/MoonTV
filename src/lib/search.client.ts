import type { SearchResult } from './types';

export interface SearchBatchResponse {
  results: SearchResult[];
  totalPages: number;
}

const SEARCH_BATCH_CONCURRENCY = 3;

export function shouldFetchSearchImmediately(
  currentQuery: string | null,
  nextQuery: string
): boolean {
  return currentQuery?.trim() === nextQuery;
}

export async function fetchSearchBatch(
  query: string,
  page: number,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<SearchBatchResponse> {
  const response = await fetchImpl(
    `/api/search?q=${encodeURIComponent(query.trim())}&page=${page}`,
    { cache: 'no-store', ...(signal ? { signal } : {}) }
  );
  if (!response.ok) {
    throw new Error('搜索失败');
  }
  const payload = (await response.json()) as Partial<SearchBatchResponse>;
  if (
    !Array.isArray(payload.results) ||
    !Number.isInteger(payload.totalPages) ||
    (payload.totalPages || 0) < 1
  ) {
    throw new Error('搜索响应格式错误');
  }
  return payload as SearchBatchResponse;
}

export async function fetchAllSearchResults(
  query: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<SearchResult[]> {
  const firstBatch = await fetchSearchBatch(query, 0, fetchImpl, signal);
  const totalPages = firstBatch.totalPages;
  const remainingBatches = new Array<SearchBatchResponse>(totalPages - 1);
  let nextPage = 1;
  await Promise.all(
    Array.from(
      { length: Math.min(SEARCH_BATCH_CONCURRENCY, totalPages - 1) },
      async () => {
        while (nextPage < totalPages) {
          const page = nextPage;
          nextPage += 1;
          remainingBatches[page - 1] = await fetchSearchBatch(
            query,
            page,
            fetchImpl,
            signal
          );
        }
      }
    )
  );

  return [firstBatch, ...remainingBatches].flatMap((batch) => batch.results);
}
