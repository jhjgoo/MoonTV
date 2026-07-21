/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-var-requires */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import type {
  PlayerEngineProps,
  PlayerHandle,
} from '@/components/player/player.types';

const mockPlayerHandle: PlayerHandle = {
  getSnapshot: jest.fn(() => ({
    currentTime: 24,
    duration: 120,
    volume: 0.5,
    playbackRate: 1,
    paused: false,
  })),
  pause: jest.fn(),
  play: jest.fn(async () => undefined),
  seek: jest.fn(),
  setVolume: jest.fn(),
  setPlaybackRate: jest.fn(),
  toggleFullscreen: jest.fn(),
};
let mockPlayerProps: PlayerEngineProps & { urlOverride: string | null };

jest.mock('next/navigation', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
  useSearchParams: () =>
    new URLSearchParams(
      'source=source-1&id=one&title=测试影片&year=2026&stitle=测试影片&player=artplayer'
    ),
}));

jest.mock('@/lib/search.client', () => ({
  fetchAllSearchResults: jest.fn(async () => [
    {
      id: 'one',
      title: '测试影片',
      poster: 'poster-one',
      episodes: ['https://example.com/one.m3u8'],
      source: 'source-1',
      source_name: '源一',
      year: '2026',
    },
    {
      id: 'two',
      title: '测试影片',
      poster: 'poster-two',
      episodes: ['https://example.com/two.m3u8'],
      source: 'source-2',
      source_name: '源二',
      year: '2026',
    },
  ]),
}));

jest.mock('@/lib/db.client', () => ({
  deleteFavorite: jest.fn(),
  deletePlayRecord: jest.fn(),
  deleteSkipConfig: jest.fn(),
  generateStorageKey: jest.fn(() => 'record'),
  getAllPlayRecords: jest.fn(async () => ({})),
  getSkipConfig: jest.fn(async () => null),
  isFavorited: jest.fn(async () => false),
  saveFavorite: jest.fn(),
  savePlayRecord: jest.fn(),
  saveSkipConfig: jest.fn(),
  subscribeToDataUpdates: jest.fn(() => jest.fn()),
}));

jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/EpisodeSelector', () => ({
  __esModule: true,
  default: ({
    onSourceChange,
  }: {
    onSourceChange: (source: string, id: string, title: string) => void;
  }) => (
    <button onClick={() => onSourceChange('source-2', 'two', '测试影片')}>
      切换源
    </button>
  ),
}));

jest.mock('@/components/player/PlayerHost', () => {
  const React = require('react');
  return {
    PlayerHost: React.forwardRef(function MockPlayerHost(props: any, ref: any) {
      React.useImperativeHandle(ref, () => mockPlayerHandle, []);
      mockPlayerProps = props;
      return <div data-testid='player-host' />;
    }),
  };
});

import PlayPage from './page';

describe('PlayPage player boundary', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('routes playback through PlayerHost without importing ArtPlayer providers', () => {
    const source = readFileSync(resolve(__dirname, 'page.tsx'), 'utf8');

    expect(source).toContain('@/components/player/PlayerHost');
    expect(source).not.toMatch(/from 'artplayer'/);
    expect(source).not.toMatch(/from 'hls\.js'/);
    expect(source).not.toContain('artPlayerRef');
  });

  test('passes generic media and routes source continuity and shortcuts through PlayerHandle', async () => {
    jest.useFakeTimers();

    render(<PlayPage />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => jest.advanceTimersByTime(1000));

    expect(screen.getByTestId('player-host')).toBeInTheDocument();
    expect(mockPlayerProps.media).toMatchObject({
      url: 'https://example.com/one.m3u8',
      title: '测试影片 - 第1集',
      poster: 'poster-one',
      autoPlay: true,
    });
    expect(mockPlayerProps.urlOverride).toBe('artplayer');
    expect(mockPlayerProps).toHaveProperty('onCanPlay', expect.any(Function));

    fireEvent.keyDown(document, { key: 'ArrowRight' });
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    fireEvent.keyDown(document, { key: ' ' });
    fireEvent.keyDown(document, { key: 'f' });
    expect(mockPlayerHandle.seek).toHaveBeenCalledWith(34);
    expect(mockPlayerHandle.setVolume).toHaveBeenCalledWith(0.6);
    expect(mockPlayerHandle.pause).toHaveBeenCalledTimes(1);
    expect(mockPlayerHandle.toggleFullscreen).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '切换源' }));
      await Promise.resolve();
    });
    expect(mockPlayerHandle.getSnapshot).toHaveBeenCalled();
    expect(screen.getByText('🔄 切换播放源...')).toBeInTheDocument();

    act(() => {
      (mockPlayerProps as any).onCanPlay();
    });
    expect(screen.queryByText('🔄 切换播放源...')).not.toBeInTheDocument();
  });
});
