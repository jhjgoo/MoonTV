import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  type SearchBatchResponse,
  fetchSearchBatch,
} from '@/lib/search.client';
import type { SearchResult } from '@/lib/types';

export type ProgressiveSearchStatus =
  | 'idle'
  | 'initial-loading'
  | 'auto-filling'
  | 'ready'
  | 'loading-more'
  | 'exhausted';

export interface ProgressiveSearchState {
  results: SearchResult[];
  status: ProgressiveSearchStatus;
  nextPage: number;
  totalPages: number;
  hasMore: boolean;
  failedPages: number[];
  loadNext: (mode: 'auto' | 'append') => Promise<void>;
  retryFailed: () => Promise<void>;
  restart: () => void;
}

export type SearchBatchFetcher = (
  query: string,
  page: number,
  signal?: AbortSignal
) => Promise<SearchBatchResponse>;

const browserFetchBatch: SearchBatchFetcher = (query, page, signal) =>
  fetchSearchBatch(query, page, fetch, signal);

function compareSearchResults(query: string) {
  const normalizedQuery = query.trim();
  return (left: SearchResult, right: SearchResult): number => {
    const leftExact = left.title === normalizedQuery;
    const rightExact = right.title === normalizedQuery;
    if (leftExact !== rightExact) return leftExact ? -1 : 1;
    if (left.year === right.year) return left.title.localeCompare(right.title);
    if (left.year === 'unknown') return 1;
    if (right.year === 'unknown') return -1;
    return Number.parseInt(right.year) - Number.parseInt(left.year);
  };
}

export function mergeSearchResults(
  existing: SearchResult[],
  incoming: SearchResult[],
  query: string,
  mode: 'auto' | 'append'
): SearchResult[] {
  const seen = new Set(existing.map((item) => `${item.source}:${item.id}`));
  const uniqueIncoming = incoming.filter((item) => {
    const key = `${item.source}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const compare = compareSearchResults(query);
  if (mode === 'append') {
    return [...existing, ...uniqueIncoming.sort(compare)];
  }
  return [...existing, ...uniqueIncoming].sort(compare);
}

export function useProgressiveSearch(
  query: string,
  fetchBatch: SearchBatchFetcher = browserFetchBatch
): ProgressiveSearchState {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState<ProgressiveSearchStatus>('idle');
  const [nextPage, setNextPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [failedPages, setFailedPages] = useState<number[]>([]);
  const [restartToken, setRestartToken] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const inFlightRef = useRef(false);
  const nextPageRef = useRef(0);
  const totalPagesRef = useRef(1);
  const failedPagesRef = useRef<number[]>([]);

  const updateFailedPages = useCallback((pages: number[]) => {
    const normalized = Array.from(new Set(pages)).sort((a, b) => a - b);
    failedPagesRef.current = normalized;
    setFailedPages(normalized);
  }, []);

  const requestPage = useCallback(
    async (pageQuery: string, page: number, signal: AbortSignal) => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          return await fetchBatch(pageQuery, page, signal);
        } catch (error) {
          if (signal.aborted) throw error;
          lastError = error;
        }
      }
      throw lastError;
    },
    [fetchBatch]
  );

  const updatePagination = useCallback((next: number, total: number) => {
    nextPageRef.current = next;
    totalPagesRef.current = total;
    setNextPage(next);
    setTotalPages(total);
  }, []);

  useEffect(() => {
    controllerRef.current?.abort();
    generationRef.current += 1;
    const generation = generationRef.current;
    setResults([]);
    updateFailedPages([]);
    updatePagination(0, 1);
    if (!query.trim()) {
      setStatus('idle');
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    inFlightRef.current = true;
    setStatus('initial-loading');
    void requestPage(query, 0, controller.signal)
      .then((batch) => {
        if (generationRef.current !== generation || controller.signal.aborted) {
          return;
        }
        setResults(mergeSearchResults([], batch.results, query, 'auto'));
        updatePagination(1, batch.totalPages);
        setStatus(batch.totalPages > 1 ? 'ready' : 'exhausted');
      })
      .catch(() => {
        if (
          generationRef.current === generation &&
          !controller.signal.aborted
        ) {
          updateFailedPages([0]);
          updatePagination(1, 1);
          setStatus('exhausted');
        }
      })
      .finally(() => {
        if (generationRef.current === generation) {
          inFlightRef.current = false;
        }
      });

    return () => controller.abort();
  }, [query, requestPage, restartToken, updateFailedPages, updatePagination]);

  const loadNext = useCallback(
    async (mode: 'auto' | 'append') => {
      if (
        inFlightRef.current ||
        !query.trim() ||
        nextPageRef.current >= totalPagesRef.current
      ) {
        return;
      }

      const page = nextPageRef.current;
      const generation = generationRef.current;
      const controller = controllerRef.current || new AbortController();
      controllerRef.current = controller;
      inFlightRef.current = true;
      setStatus(mode === 'auto' ? 'auto-filling' : 'loading-more');
      try {
        const batch = await requestPage(query, page, controller.signal);
        if (generationRef.current !== generation || controller.signal.aborted) {
          return;
        }
        setResults((current) =>
          mergeSearchResults(current, batch.results, query, mode)
        );
        updatePagination(page + 1, batch.totalPages);
        setStatus(page + 1 >= batch.totalPages ? 'exhausted' : 'ready');
      } catch (error) {
        if (generationRef.current !== generation || controller.signal.aborted) {
          return;
        }
        updateFailedPages([...failedPagesRef.current, page]);
        const next = page + 1;
        updatePagination(next, totalPagesRef.current);
        setStatus(next >= totalPagesRef.current ? 'exhausted' : 'ready');
      } finally {
        if (generationRef.current === generation) {
          inFlightRef.current = false;
        }
      }
    },
    [query, requestPage, updateFailedPages, updatePagination]
  );

  const retryFailed = useCallback(async () => {
    if (inFlightRef.current || failedPagesRef.current.length === 0) return;
    const generation = generationRef.current;
    const controller = controllerRef.current || new AbortController();
    controllerRef.current = controller;
    inFlightRef.current = true;
    setStatus('loading-more');
    try {
      for (const page of [...failedPagesRef.current]) {
        try {
          const batch = await requestPage(query, page, controller.signal);
          if (
            generationRef.current !== generation ||
            controller.signal.aborted
          ) {
            return;
          }
          setResults((current) =>
            mergeSearchResults(current, batch.results, query, 'append')
          );
          updateFailedPages(
            failedPagesRef.current.filter((failedPage) => failedPage !== page)
          );
          if (batch.totalPages > totalPagesRef.current) {
            updatePagination(nextPageRef.current, batch.totalPages);
          }
        } catch (error) {
          if (controller.signal.aborted) return;
        }
      }
      setStatus(
        nextPageRef.current >= totalPagesRef.current ? 'exhausted' : 'ready'
      );
    } finally {
      if (generationRef.current === generation) {
        inFlightRef.current = false;
      }
    }
  }, [query, requestPage, updateFailedPages, updatePagination]);

  const restart = useCallback(() => {
    setRestartToken((token) => token + 1);
  }, []);

  return useMemo(
    () => ({
      results,
      status,
      nextPage,
      totalPages,
      hasMore: nextPage < totalPages,
      failedPages,
      loadNext,
      retryFailed,
      restart,
    }),
    [
      failedPages,
      loadNext,
      nextPage,
      restart,
      retryFailed,
      results,
      status,
      totalPages,
    ]
  );
}
