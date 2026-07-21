/* eslint-disable @typescript-eslint/no-explicit-any */

import { act, render, screen } from '@testing-library/react';
import { createRef, forwardRef, useEffect } from 'react';

import type { PlayerHandle } from './player.types';
import { VidstackEngine } from './VidstackEngine';

const playerEventListeners = new Map<string, Set<EventListener>>();
const player = {
  currentTime: 12,
  duration: 120,
  volume: 0.7,
  playbackRate: 1,
  paused: false,
  state: {
    remotePlaybackType: 'none',
    remotePlaybackState: 'disconnected',
  },
  play: jest.fn(async () => undefined),
  pause: jest.fn(async () => undefined),
  enterFullscreen: jest.fn(async () => undefined),
  exitFullscreen: jest.fn(async () => undefined),
  addEventListener: jest.fn((type: string, listener: EventListener) => {
    const listeners =
      playerEventListeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    playerEventListeners.set(type, listeners);
  }),
  removeEventListener: jest.fn((type: string, listener: EventListener) => {
    playerEventListeners.get(type)?.delete(listener);
  }),
};

function dispatchPlayerEvent(event: Event) {
  playerEventListeners.get(event.type)?.forEach((listener) => listener(event));
}

function createPlayerEvent(type: string, detail: unknown): Event {
  return Object.assign(new Event(type), { detail });
}
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
  AirPlayButton: function MockAirPlayButton({ children, ...props }: any) {
    return (
      <button data-hidden='' type='button' {...props}>
        {children}
      </button>
    );
  },
  GoogleCastButton: function MockGoogleCastButton({ children, ...props }: any) {
    return (
      <button data-hidden='' type='button' {...props}>
        {children}
      </button>
    );
  },
}));

jest.mock(
  '@vidstack/react/icons',
  () => ({
    AirPlayIcon: () => <svg data-testid='airplay-icon' />,
    ChromecastIcon: () => <svg data-testid='google-cast-icon' />,
  }),
  { virtual: true }
);

jest.mock(
  '@vidstack/react/player/layouts/default',
  () => ({
    DefaultVideoLayout: ({ slots }: any) => (
      <div data-testid='vidstack-default-layout'>
        {slots?.airPlayButton}
        {slots?.googleCastButton}
      </div>
    ),
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
    player.state.remotePlaybackType = 'none';
    player.state.remotePlaybackState = 'disconnected';
    player.play.mockClear();
    player.pause.mockClear();
    player.enterFullscreen.mockClear();
    player.exitFullscreen.mockClear();
    player.addEventListener.mockClear();
    player.removeEventListener.mockClear();
    playerEventListeners.clear();
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

  test('renders capability-gated AirPlay and Google Cast controls', () => {
    render(<VidstackEngine {...defaultProps} />);

    expect(screen.getByRole('button', { name: 'AirPlay' })).toHaveAttribute(
      'data-hidden',
      ''
    );
    expect(screen.getByRole('button', { name: 'Google Cast' })).toHaveAttribute(
      'data-hidden',
      ''
    );
    expect(screen.getByTestId('airplay-icon')).toBeInTheDocument();
    expect(screen.getByTestId('google-cast-icon')).toBeInTheDocument();
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

  test('reports Google Cast prompt errors as nonfatal remote playback failures', () => {
    const onFailure = jest.fn();
    render(<VidstackEngine {...defaultProps} onFailure={onFailure} />);
    const cause = Object.assign(new Error('No receiver found'), {
      code: 'NO_DEVICES_AVAILABLE',
    });

    act(() => {
      dispatchPlayerEvent(createPlayerEvent('google-cast-prompt-error', cause));
    });

    expect(onFailure).toHaveBeenCalledWith({
      kind: 'remote-playback',
      fatal: false,
      message: 'Google Cast 投屏失败',
      cause,
    });
  });

  test('reports generic errors during active remote playback without unmounting', () => {
    const onFailure = jest.fn();
    render(<VidstackEngine {...defaultProps} onFailure={onFailure} />);
    player.state.remotePlaybackType = 'google-cast';
    player.state.remotePlaybackState = 'connected';
    const cause = new Error('receiver load failed');

    act(() => mediaPlayerProps.onError(cause));

    expect(onFailure).toHaveBeenCalledWith({
      kind: 'remote-playback',
      fatal: false,
      message: '远程播放错误',
      cause,
    });
    expect(screen.getByTestId('vidstack-media-player')).toBeInTheDocument();
    expect(providerUnmount).not.toHaveBeenCalled();
  });

  test('reports provider errors after remote disconnect as fatal local playback failures', () => {
    const onFailure = jest.fn();
    render(<VidstackEngine {...defaultProps} onFailure={onFailure} />);
    player.state.remotePlaybackType = 'google-cast';
    player.state.remotePlaybackState = 'disconnected';
    const cause = new Error('local provider failed after disconnect');

    act(() => mediaPlayerProps.onError(cause));

    expect(onFailure).toHaveBeenCalledWith({
      kind: 'playback',
      fatal: true,
      message: 'Vidstack 播放错误',
      cause,
    });
  });

  test('reports remote disconnects without escalating them to fatal local failures', () => {
    const onFailure = jest.fn();
    render(<VidstackEngine {...defaultProps} onFailure={onFailure} />);
    const detail = { type: 'airplay', state: 'disconnected' };

    act(() => {
      dispatchPlayerEvent(createPlayerEvent('remote-playback-change', detail));
    });

    expect(onFailure).toHaveBeenCalledWith({
      kind: 'remote-playback',
      fatal: false,
      message: '远程播放已断开',
      cause: detail,
    });
    expect(screen.getByTestId('vidstack-media-player')).toBeInTheDocument();
  });

  test('keeps remote playback listeners singular across rerenders and cleans them up', () => {
    const initialFailure = jest.fn();
    const currentFailure = jest.fn();
    const view = render(
      <VidstackEngine {...defaultProps} onFailure={initialFailure} />
    );

    view.rerender(
      <VidstackEngine {...defaultProps} onFailure={currentFailure} />
    );
    const cause = new Error('Cast canceled');
    act(() => {
      dispatchPlayerEvent(
        new CustomEvent('google-cast-prompt-error', { detail: cause })
      );
    });

    expect(initialFailure).not.toHaveBeenCalled();
    expect(currentFailure).toHaveBeenCalledTimes(1);
    expect(player.addEventListener).toHaveBeenCalledTimes(2);

    view.unmount();
    expect(player.removeEventListener).toHaveBeenCalledTimes(2);

    act(() => {
      dispatchPlayerEvent(
        new CustomEvent('google-cast-prompt-error', { detail: cause })
      );
    });
    expect(currentFailure).toHaveBeenCalledTimes(1);
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

  test('reports one fatal local failure when a media URL cannot play within twenty seconds', () => {
    jest.useFakeTimers();
    const onFailure = jest.fn();
    render(<VidstackEngine {...defaultProps} onFailure={onFailure} />);

    act(() => jest.advanceTimersByTime(20_000));

    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith({
      kind: 'playback',
      fatal: true,
      message: 'Vidstack 在 20 秒内未进入可播放状态',
    });
    act(() => jest.advanceTimersByTime(20_000));
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  test('clears the can-play watchdog after canplay and restarts it for a new media URL', () => {
    jest.useFakeTimers();
    const onFailure = jest.fn();
    const view = render(
      <VidstackEngine {...defaultProps} onFailure={onFailure} />
    );

    act(() => mediaPlayerProps.onCanPlay());
    act(() => jest.advanceTimersByTime(20_000));
    expect(onFailure).not.toHaveBeenCalled();

    view.rerender(
      <VidstackEngine
        {...defaultProps}
        media={{ ...defaultProps.media, url: 'https://example.com/next.m3u8' }}
        onFailure={onFailure}
      />
    );
    act(() => jest.advanceTimersByTime(20_000));
    expect(onFailure).toHaveBeenCalledWith({
      kind: 'playback',
      fatal: true,
      message: 'Vidstack 在 20 秒内未进入可播放状态',
    });
  });

  test('keeps the can-play watchdog running after a cancelled Cast prompt', () => {
    jest.useFakeTimers();
    const onFailure = jest.fn();
    render(<VidstackEngine {...defaultProps} onFailure={onFailure} />);

    act(() => {
      dispatchPlayerEvent(
        createPlayerEvent('google-cast-prompt-error', new Error('cancelled'))
      );
    });
    act(() => jest.advanceTimersByTime(20_000));

    expect(onFailure).toHaveBeenCalledTimes(2);
    expect(onFailure).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ kind: 'remote-playback', fatal: false })
    );
    expect(onFailure).toHaveBeenNthCalledWith(2, {
      kind: 'playback',
      fatal: true,
      message: 'Vidstack 在 20 秒内未进入可播放状态',
    });
  });

  test('keeps the can-play watchdog running after a remote disconnect', () => {
    jest.useFakeTimers();
    const onFailure = jest.fn();
    render(<VidstackEngine {...defaultProps} onFailure={onFailure} />);
    const detail = { type: 'google-cast', state: 'disconnected' };

    act(() => {
      dispatchPlayerEvent(createPlayerEvent('remote-playback-change', detail));
    });
    act(() => jest.advanceTimersByTime(20_000));

    expect(onFailure).toHaveBeenCalledTimes(2);
    expect(onFailure).toHaveBeenNthCalledWith(1, {
      kind: 'remote-playback',
      fatal: false,
      message: '远程播放已断开',
      cause: detail,
    });
    expect(onFailure).toHaveBeenNthCalledWith(2, {
      kind: 'playback',
      fatal: true,
      message: 'Vidstack 在 20 秒内未进入可播放状态',
    });
  });

  test('cleans up the can-play watchdog on unmount', () => {
    jest.useFakeTimers();
    const onFailure = jest.fn();
    const { unmount } = render(
      <VidstackEngine {...defaultProps} onFailure={onFailure} />
    );

    unmount();
    act(() => jest.advanceTimersByTime(20_000));
    expect(onFailure).not.toHaveBeenCalled();
  });
});
