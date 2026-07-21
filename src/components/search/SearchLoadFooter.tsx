import type { ProgressiveSearchStatus } from '@/hooks/useProgressiveSearch';

interface SearchLoadFooterProps {
  status: ProgressiveSearchStatus;
  hasResults: boolean;
  hasMore: boolean;
  failedCount: number;
  observerSupported: boolean;
  onLoadMore: () => void;
  onRetryFailed: () => void;
}

export default function SearchLoadFooter({
  status,
  hasResults,
  hasMore,
  failedCount,
  observerSupported,
  onLoadMore,
  onRetryFailed,
}: SearchLoadFooterProps) {
  const isLoading = status === 'auto-filling' || status === 'loading-more';
  const isExhausted = status === 'exhausted' && !hasMore;

  return (
    <div className='flex min-h-12 flex-col items-center justify-center gap-3 py-6 text-sm text-gray-500 dark:text-gray-400'>
      {isLoading && (
        <div className='flex items-center gap-2'>
          <span className='h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-b-green-500' />
          <span>正在继续搜索其他视频源</span>
        </div>
      )}

      {!observerSupported && hasMore && !isLoading && (
        <button
          type='button'
          onClick={onLoadMore}
          className='rounded-lg bg-green-500 px-4 py-2 text-white transition-colors hover:bg-green-600'
        >
          加载更多
        </button>
      )}

      {isExhausted && hasResults && failedCount === 0 && (
        <span>已加载全部结果</span>
      )}

      {failedCount > 0 && (
        <div className='flex items-center gap-3'>
          <span>部分视频源加载失败</span>
          <button
            type='button'
            onClick={onRetryFailed}
            className='text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300'
          >
            重试失败批次
          </button>
        </div>
      )}
    </div>
  );
}
