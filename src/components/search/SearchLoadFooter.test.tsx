import { fireEvent, render, screen } from '@testing-library/react';

import SearchLoadFooter from './SearchLoadFooter';

const baseProps = {
  status: 'ready' as const,
  hasResults: true,
  hasMore: true,
  failedCount: 0,
  observerSupported: true,
  onLoadMore: jest.fn(),
  onRetryFailed: jest.fn(),
};

describe('SearchLoadFooter', () => {
  beforeEach(() => jest.clearAllMocks());

  test('shows incremental loading feedback', () => {
    render(<SearchLoadFooter {...baseProps} status='auto-filling' />);

    expect(screen.getByText('正在继续搜索其他视频源')).toBeInTheDocument();
  });

  test('shows completion after all pages are exhausted', () => {
    render(
      <SearchLoadFooter {...baseProps} status='exhausted' hasMore={false} />
    );

    expect(screen.getByText('已加载全部结果')).toBeInTheDocument();
  });

  test('retries failed batches without hiding completed results', () => {
    const onRetryFailed = jest.fn();
    render(
      <SearchLoadFooter
        {...baseProps}
        status='exhausted'
        hasMore={false}
        failedCount={2}
        onRetryFailed={onRetryFailed}
      />
    );

    expect(screen.getByText('部分视频源加载失败')).toBeInTheDocument();
    expect(screen.queryByText('已加载全部结果')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试失败批次' }));
    expect(onRetryFailed).toHaveBeenCalledTimes(1);
  });

  test('offers manual loading when IntersectionObserver is unavailable', () => {
    const onLoadMore = jest.fn();
    render(
      <SearchLoadFooter
        {...baseProps}
        observerSupported={false}
        onLoadMore={onLoadMore}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});
