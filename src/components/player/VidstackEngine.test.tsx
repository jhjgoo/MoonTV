/* eslint-disable @typescript-eslint/no-explicit-any */

import { act, render, screen } from '@testing-library/react';
import { createRef, forwardRef, useEffect } from 'react';

import type { PlayerHandle } from './player.types';
import { VidstackEngine } from './VidstackEngine';

const player = {
  currentTime: 12,
  duration: 120,
  volume: 0.7,
  playbackRate: 1,
  paused: false,
  play: jest.fn(async () => undefined),
  pause: jest.fn(async () => undefined),
  enterFullscreen: jest.fn(async () => undefined),
  exitFullscreen: jest.fn(async () => undefined),
};
let mediaPlayerProps: Record<string, any> = {};
const providerUnmount = jest.fn();

jest.mock('@vidstack/react', () => ({
  MediaPlayer: forwardRef(function MockMediaPlayer(props: any, ref: any) {
    useEffect(() => {
      if (typeof ref === 'function') {
        ref(player);
        return () => ref(null);
      }
      if (ref) ref.current = player;
      return undefined;
    }, [ref]);
    mediaPlayerProps = props;
    return <div data-testid='vidstack-media-player'>{props.children}</div>;
  }),
  MediaProvider: function MockMediaProvider() {
    useEffect(() => () => providerUnmount(), []);
    return <div data-testid='vidstack-media-provider' />;
  },
}));

jest.mock(
  '@vidstack/react/player/layouts/default',
  () => ({
    DefaultVideoLayout: () => <div data-testid='vidstack-default-layout' />,
  }),
  { virtual: true }
);

const defaultProps = {
  media: {
    url: 'https://example.com/episode.m3u8',
    title: '节目 - 第 1 集',
    poster: 'https://example.com/poster.jpg',
  },
  onReady: jest.fn(),
  onTimeUpdate: jest.fn(),
  onEnded: jest.fn(),
  onPlay: jest.fn(),
  onPause: jest.fn(),
  onFailure: jest.fn(),
};

describe('VidstackEngine', () => {
  beforeEach(() => {
    player.currentTime = 12;
    player.duration = 120;
    player.volume = 0.7;
    player.playbackRate = 1;
    player.paused = false;
    player.play.mockClear();
    player.pause.mockClear();
    player.enterFullscreen.mockClear();
    player.exitFullscreen.mockClear();
    providerUnmount.mockClear();
    mediaPlayerProps = {};
  });

  test('passes HLS media metadata and renders the provider with default layout', () => {
    render(<VidstackEngine {...defaultProps} />);

    expect(mediaPlayerProps).toEqual(
      expect.objectContaining({
        src: {
          src: 'https://example.com/episode.m3u8',
          type: 'application/x-mpegurl',
        },
        title: '节目 - 第 1 集',
        poster: 'https://example.com/poster.jpg',
        autoPlay: true,
        playsInline: true,
        crossOrigin: 'anonymous',
      })
    );
    expect(screen.getByTestId('vidstack-media-provider')).toBeInTheDocument();
    expect(screen.getByTestId('vidstack-default-layout')).toBeInTheDocument();
  });

  test('restores a snapshot once on canplay and maps generic media events', () => {
    const onCanPlay = jest.fn();
    const onTimeUpdate = jest.fn();
    const onPlay = jest.fn();
    const onPause = jest.fn();
    const onEnded = jest.fn();
    const restoreSnapshot = {
      currentTime: 48,
      duration: 120,
      volume: 0.35,
      playbackRate: 1.5,
      paused: false,
    };
    render(
      <VidstackEngine
        {...defaultProps}
        restoreSnapshot={restoreSnapshot}
        onCanPlay={onCanPlay}
        onTimeUpdate={onTimeUpdate}
        onPlay={onPlay}
        onPause={onPause}
        onEnded={onEnded}
      />
    );

    act(() => {
      mediaPlayerProps.onCanPlay();
      mediaPlayerProps.onCanPlay();
      mediaPlayerProps.onTimeUpdate();
      mediaPlayerProps.onPlay();
      mediaPlayerProps.onPause();
      mediaPlayerProps.onEnded();
    });

    expect(player).toMatchObject({
      currentTime: 48,
      volume: 0.35,
      playbackRate: 1.5,
      paused: false,
    });
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(onCanPlay).toHaveBeenCalledTimes(2);
    expect(onTimeUpdate).toHaveBeenCalledWith({
      currentTime: 48,
      duration: 120,
      volume: 0.35,
      playbackRate: 1.5,
      paused: false,
    });
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  test('exposes the generic imperative handle against the MediaPlayer instance', async () => {
    const ref = createRef<PlayerHandle>();
    render(<VidstackEngine {...defaultProps} ref={ref} />);

    await ref.current?.play();
    ref.current?.pause();
    ref.current?.seek(30);
    ref.current?.setVolume(0.25);
    ref.current?.setPlaybackRate(1.25);
    await ref.current?.toggleFullscreen();

    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(player.currentTime).toBe(30);
    expect(player.volume).toBe(0.25);
    expect(player.playbackRate).toBe(1.25);
    expect(player.enterFullscreen).toHaveBeenCalledTimes(1);
    expect(ref.current?.getSnapshot()).toEqual({
      currentTime: 30,
      duration: 120,
      volume: 0.25,
      playbackRate: 1.25,
      paused: false,
    });
  });

  test('reports local media errors as fatal playback failures and unmounts cleanly', () => {
    const onFailure = jest.fn();
    const { unmount } = render(
      <VidstackEngine {...defaultProps} onFailure={onFailure} />
    );

    act(() => mediaPlayerProps.onError(new Error('provider failed')));
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'playback',
        fatal: true,
        message: 'Vidstack 播放错误',
      })
    );

    unmount();
    expect(providerUnmount).toHaveBeenCalledTimes(1);
  });

  test('does not announce ready again and clear a fatal error after rerender', () => {
    let fatalError: string | null = null;
    const onReady = jest.fn(() => {
      fatalError = null;
    });
    const onFailure = jest.fn(() => {
      fatalError = 'provider failed';
    });
    const view = render(
      <VidstackEngine
        {...defaultProps}
        onFailure={onFailure}
        onReady={onReady}
      />
    );

    act(() => mediaPlayerProps.onError(new Error('provider failed')));
    expect(fatalError).toBe('provider failed');

    view.rerender(
      <VidstackEngine
        {...defaultProps}
        onFailure={onFailure}
        onReady={onReady}
      />
    );

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(fatalError).toBe('provider failed');
  });
});
