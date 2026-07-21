import { act, render, screen, waitFor } from '@testing-library/react';

import type { SearchResult } from '@/lib/types';
import type { ProgressiveSearchState } from '@/hooks/useProgressiveSearch';

import SearchPage from './page';

const push = jest.fn();
const loadNext = jest.fn();
const retryFailed = jest.fn();
const restart = jest.fn();
const mockUseProgressiveSearch = jest.fn();
const searchParams = new URLSearchParams('q=测试');
let intersectionCallback: IntersectionObserverCallback | undefined;

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParams,
}));

jest.mock('@/hooks/useProgressiveSearch', () => ({
  useProgressiveSearch: (...args: unknown[]) =>
    mockUseProgressiveSearch(...args),
}));

jest.mock('@/lib/db.client', () => ({
  addSearchHistory: jest.fn(),
  clearSearchHistory: jest.fn(),
  deleteSearchHistory: jest.fn(),
  getSearchHistory: jest.fn().mockResolvedValue([]),
  subscribeToDataUpdates: jest.fn(() => jest.fn()),
}));

jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/VideoCard', () => ({
  __esModule: true,
  default: ({ title, items }: { title?: string; items?: SearchResult[] }) => (
    <div>{title || items?.[0]?.title}</div>
  ),
}));

function searchResult(id: string): SearchResult {
  return {
    id,
    title: `第一批结果 ${id}`,
    poster: '',
    episodes: [],
    source: 'safe',
    source_name: '安全源',
    year: '2026',
  };
}

function state(
  overrides: Partial<ProgressiveSearchState> = {}
): ProgressiveSearchState {
  return {
    results: [searchResult('1')],
    status: 'ready',
    nextPage: 1,
    totalPages: 2,
    hasMore: true,
    failedPages: [],
    loadNext,
    retryFailed,
    restart,
    ...overrides,
  };
}

describe('SearchPage progressive loading', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    intersectionCallback = undefined;
    mockUseProgressiveSearch.mockReturnValue(state());
    Object.defineProperty(window, 'IntersectionObserver', {
      configurable: true,
      writable: true,
      value: class {
        constructor(callback: IntersectionObserverCallback) {
          intersectionCallback = callback;
        }
        observe = jest.fn();
        disconnect = jest.fn();
        unobserve = jest.fn();
        takeRecords() {
          return [];
        }
        root = null;
        rootMargin = '';
        thresholds = [];
      },
    });
    window.requestAnimationFrame = jest.fn();
  });

  test('renders the first batch immediately', async () => {
    render(<SearchPage />);

    expect(await screen.findByText('第一批结果 1')).toBeInTheDocument();
    expect(screen.queryByText('未找到相关结果')).not.toBeInTheDocument();
  });

  test('loads the next batch when the bottom sentinel is visible', async () => {
    render(<SearchPage />);
    await waitFor(() => expect(intersectionCallback).toBeDefined());

    act(() => {
      intersectionCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    await waitFor(() => expect(loadNext).toHaveBeenCalledWith('auto'));
  });

  test('shows the final empty state only after all batches are exhausted', async () => {
    mockUseProgressiveSearch.mockReturnValue(
      state({ results: [], status: 'exhausted', hasMore: false })
    );

    render(<SearchPage />);

    expect(await screen.findByText('未找到相关结果')).toBeInTheDocument();
  });
});
