import { act, render, screen, waitFor } from '@testing-library/react';
import { createRef, forwardRef, useImperativeHandle } from 'react';

import type {
  PlayerEngine,
  PlayerEngineComponent,
  PlayerEngineProps,
  PlayerEnhancements,
  PlayerHandle,
} from './player.types';
import {
  ARTPLAYER_CAPABILITIES,
  PlayerHost,
  VIDSTACK_CAPABILITIES,
} from './PlayerHost';

jest.mock('./ArtPlayerEngine', () => ({
  ArtPlayerEngine: forwardRef<PlayerHandle, PlayerEngineProps>(
    function DefaultArtPlayerEngine(_props, ref) {
      useImperativeHandle(ref, () => createFakeHandle(), []);
      return <div data-testid='default-artplayer-engine' />;
    }
  ),
}));

jest.mock('./VidstackEngine', () => ({
  VidstackEngine: forwardRef<PlayerHandle, PlayerEngineProps>(
    function DefaultVidstackEngine(_props, ref) {
      useImperativeHandle(ref, () => createFakeHandle(), []);
      return <div data-testid='default-vidstack-engine' />;
    }
  ),
}));

function createFakeHandle(): PlayerHandle {
  return {
    getSnapshot: () => ({
      currentTime: 0,
      duration: 0,
      volume: 0.7,
      playbackRate: 1,
      paused: true,
    }),
    pause: jest.fn(),
    play: jest.fn(async () => undefined),
    seek: jest.fn(),
    setPlaybackRate: jest.fn(),
    setVolume: jest.fn(),
    toggleFullscreen: jest.fn(),
  };
}

function createFakeEngine(
  testId: string,
  handle = createFakeHandle(),
  onRender?: (props: PlayerEngineProps) => void
): PlayerEngineComponent {
  return forwardRef<PlayerHandle, PlayerEngineProps>(function FakeEngine(
    props,
    ref
  ) {
    useImperativeHandle(ref, () => handle);
    onRender?.(props);

    return <div data-testid={testId} />;
  });
}

const FakeArtPlayerEngine = createFakeEngine('fake-artplayer-engine');
const FakeVidstackEngine = createFakeEngine('fake-vidstack-engine');

describe('PlayerHost', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    localStorage.clear();
  });

  test('shows an accessible loading placeholder while engine preference is unresolved', () => {
    render(
      <PlayerHost
        media={{ url: 'https://example.com/video.m3u8', title: 'Episode 1' }}
        urlOverride={null}
        resolvePreference={() => new Promise(() => undefined)}
      />
    );

    expect(screen.getByLabelText('正在加载播放器')).toBeInTheDocument();
    expect(screen.queryByTestId('artplayer-engine')).not.toBeInTheDocument();
    expect(screen.queryByTestId('vidstack-engine')).not.toBeInTheDocument();
  });

  test('exposes safe imperative defaults before preference resolution', async () => {
    const playerRef = createRef<PlayerHandle>();

    render(
      <PlayerHost
        ref={playerRef}
        media={{ url: 'https://example.com/video.m3u8', title: 'Episode 1' }}
        urlOverride={null}
        resolvePreference={() => new Promise(() => undefined)}
      />
    );

    expect(playerRef.current?.getSnapshot()).toEqual({
      currentTime: 0,
      duration: 0,
      volume: 0.7,
      playbackRate: 1,
      paused: true,
    });
    await expect(playerRef.current?.play()).resolves.toBeUndefined();
    expect(() => {
      playerRef.current?.pause();
      playerRef.current?.seek(12);
      playerRef.current?.setVolume(0.3);
      playerRef.current?.setPlaybackRate(1.5);
      playerRef.current?.toggleFullscreen();
    }).not.toThrow();
  });

  test('mounts only the injected ArtPlayer engine after resolving a local preference', async () => {
    render(
      <PlayerHost
        media={{ url: 'https://example.com/video.m3u8', title: 'Episode 1' }}
        urlOverride={null}
        engines={{
          artplayer: FakeArtPlayerEngine,
          vidstack: FakeVidstackEngine,
        }}
        resolvePreference={() => 'artplayer'}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('fake-artplayer-engine')).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId('fake-vidstack-engine')
    ).not.toBeInTheDocument();
  });

  test('forwards enhancements unchanged to the selected engine', async () => {
    const enhancements: PlayerEnhancements = {
      adFiltering: {
        enabled: true,
        onChange: jest.fn(),
      },
      skip: {
        config: {
          enable: true,
          intro_time: 12,
          outro_time: 24,
        },
        onChange: jest.fn(),
      },
      onNextEpisode: jest.fn(),
    };
    const onRender = jest.fn();
    const FakeEngine = createFakeEngine(
      'enhancements-artplayer-engine',
      createFakeHandle(),
      onRender
    );

    render(
      <PlayerHost
        enhancements={enhancements}
        media={{ url: 'https://example.com/video.m3u8', title: 'Episode 1' }}
        urlOverride={null}
        engines={{ artplayer: FakeEngine }}
        resolvePreference={() => 'artplayer'}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('enhancements-artplayer-engine')
      ).toBeInTheDocument();
    });
    expect(onRender).toHaveBeenLastCalledWith(
      expect.objectContaining({ enhancements })
    );
  });

  test('uses the ArtPlayer adapter by default when no adapter is injected', async () => {
    render(
      <PlayerHost
        media={{ url: 'https://example.com/video.m3u8', title: 'Episode 1' }}
        urlOverride={null}
        resolvePreference={() => 'artplayer'}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('default-artplayer-engine')
      ).toBeInTheDocument();
    });
    expect(screen.queryByTestId('vidstack-engine')).not.toBeInTheDocument();
  });

  test('uses the Vidstack adapter by default when the resolved preference is Vidstack', async () => {
    render(
      <PlayerHost
        media={{ url: 'https://example.com/video.m3u8', title: 'Episode 1' }}
        urlOverride='vidstack'
        resolvePreference={() => 'vidstack'}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('default-vidstack-engine')).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId('default-artplayer-engine')
    ).not.toBeInTheDocument();
  });

  test('forwards imperative controls to the selected engine', async () => {
    const snapshot = {
      currentTime: 24,
      duration: 120,
      volume: 0.5,
      playbackRate: 1.25,
      paused: false,
    };
    const pause = jest.fn();
    const play = jest.fn(async () => undefined);
    const seek = jest.fn();
    const setPlaybackRate = jest.fn();
    const setVolume = jest.fn();
    const toggleFullscreen = jest.fn(async () => undefined);
    const FakeEngine = createFakeEngine('controlled-artplayer-engine', {
      getSnapshot: () => snapshot,
      pause,
      play,
      seek,
      setPlaybackRate,
      setVolume,
      toggleFullscreen,
    });
    const playerRef = createRef<PlayerHandle>();

    render(
      <PlayerHost
        ref={playerRef}
        media={{ url: 'https://example.com/video.m3u8', title: 'Episode 1' }}
        urlOverride={null}
        engines={{ artplayer: FakeEngine }}
        resolvePreference={() => 'artplayer'}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('controlled-artplayer-engine')
      ).toBeInTheDocument();
    });

    const player = playerRef.current;
    expect(player?.getSnapshot()).toBe(snapshot);
    await expect(player?.play()).resolves.toBeUndefined();
    player?.pause();
    player?.seek(36);
    player?.setVolume(0.8);
    player?.setPlaybackRate(1.5);
    await expect(player?.toggleFullscreen()).resolves.toBeUndefined();

    expect(play).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(seek).toHaveBeenCalledWith(36);
    expect(setVolume).toHaveBeenCalledWith(0.8);
    expect(setPlaybackRate).toHaveBeenCalledWith(1.5);
    expect(toggleFullscreen).toHaveBeenCalledTimes(1);
  });

  test('uses a valid Vidstack URL override without changing the stored preference', async () => {
    localStorage.setItem('preferredPlayer', 'artplayer');
    const setItem = jest.spyOn(Storage.prototype, 'setItem');

    render(
      <PlayerHost
        media={{ url: 'https://example.com/video.m3u8', title: 'Episode 1' }}
        urlOverride='vidstack'
        engines={{
          artplayer: FakeArtPlayerEngine,
          vidstack: FakeVidstackEngine,
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('fake-vidstack-engine')).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId('fake-artplayer-engine')
    ).not.toBeInTheDocument();
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.getItem('preferredPlayer')).toBe('artplayer');
    setItem.mockRestore();
  });

  test('uses a stored valid Vidstack preference when the URL input is invalid', async () => {
    localStorage.setItem('preferredPlayer', 'vidstack');

    render(
      <PlayerHost
        media={{ url: 'https://example.com/video.m3u8', title: 'Episode 1' }}
        urlOverride='unsupported-player'
        engines={{
          artplayer: FakeArtPlayerEngine,
          vidstack: FakeVidstackEngine,
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('fake-vidstack-engine')).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId('fake-artplayer-engine')
    ).not.toBeInTheDocument();
  });

  test('uses ArtPlayer when a synchronous resolver error occurs without writing storage', async () => {
    localStorage.setItem('preferredPlayer', 'vidstack');
    const setItem = jest.spyOn(Storage.prototype, 'setItem');
    const onEngineChange = jest.fn();

    render(
      <PlayerHost
        media={{ url: 'https://example.com/video.m3u8', title: 'Episode 1' }}
        urlOverride={null}
        engines={{
          artplayer: FakeArtPlayerEngine,
          vidstack: FakeVidstackEngine,
        }}
        onEngineChange={onEngineChange}
        resolvePreference={() => {
          throw new Error('resolver failed');
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('fake-artplayer-engine')).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId('fake-vidstack-engine')
    ).not.toBeInTheDocument();
    expect(onEngineChange).toHaveBeenCalledWith(
      'artplayer',
      ARTPLAYER_CAPABILITIES
    );
    expect(setItem).not.toHaveBeenCalled();
  });

  test('uses ArtPlayer when an asynchronous resolver error occurs', async () => {
    const onEngineChange = jest.fn();

    render(
      <PlayerHost
        media={{ url: 'https://example.com/video.m3u8', title: 'Episode 1' }}
        urlOverride={null}
        engines={{
          artplayer: FakeArtPlayerEngine,
          vidstack: FakeVidstackEngine,
        }}
        onEngineChange={onEngineChange}
        resolvePreference={() => Promise.reject(new Error('resolver failed'))}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('fake-artplayer-engine')).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId('fake-vidstack-engine')
    ).not.toBeInTheDocument();
    expect(onEngineChange).toHaveBeenCalledTimes(1);
  });

  test('ignores resolver rejection after unmounting', async () => {
    let rejectResolver: (reason?: unknown) => void = () => undefined;
    const resolution = new Promise<PlayerEngine>((_resolve, reject) => {
      rejectResolver = reject;
    });
    const onEngineChange = jest.fn();
    const { unmount } = render(
      <PlayerHost
        media={{ url: 'https://example.com/video.m3u8', title: 'Episode 1' }}
        urlOverride={null}
        onEngineChange={onEngineChange}
        resolvePreference={() => resolution}
      />
    );

    unmount();
    rejectResolver(new Error('resolver failed after unmount'));
    await Promise.resolve();
    await Promise.resolve();

    expect(onEngineChange).not.toHaveBeenCalled();
  });

  test.each([
    ['missing', null],
    ['invalid', 'unsupported-player'],
  ])(
    'uses the ArtPlayer default for a %s stored preference',
    async (_description, storedPreference) => {
      if (storedPreference !== null) {
        localStorage.setItem('preferredPlayer', storedPreference);
      }

      render(
        <PlayerHost
          media={{ url: 'https://example.com/video.m3u8', title: 'Episode 1' }}
          urlOverride={null}
          engines={{
            artplayer: FakeArtPlayerEngine,
            vidstack: FakeVidstackEngine,
          }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('fake-artplayer-engine')).toBeInTheDocument();
      });
      expect(
        screen.queryByTestId('fake-vidstack-engine')
      ).not.toBeInTheDocument();
    }
  );

  test('reports the selected engine capabilities once and does not live-switch on rerender', async () => {
    const onEngineChange = jest.fn();
    const resolvePreference = jest.fn(() => 'artplayer' as const);
    const media = {
      url: 'https://example.com/video.m3u8',
      title: 'Episode 1',
    };
    const engines = {
      artplayer: FakeArtPlayerEngine,
      vidstack: FakeVidstackEngine,
    };
    const { rerender } = render(
      <PlayerHost
        media={media}
        urlOverride={null}
        engines={engines}
        onEngineChange={onEngineChange}
        resolvePreference={resolvePreference}
      />
    );

    await waitFor(() => {
      expect(onEngineChange).toHaveBeenCalledWith(
        'artplayer',
        ARTPLAYER_CAPABILITIES
      );
    });
    expect(Object.isFrozen(ARTPLAYER_CAPABILITIES)).toBe(true);
    expect(Object.isFrozen(VIDSTACK_CAPABILITIES)).toBe(true);

    rerender(
      <PlayerHost
        media={media}
        urlOverride='vidstack'
        engines={engines}
        onEngineChange={onEngineChange}
        resolvePreference={resolvePreference}
      />
    );

    expect(screen.getByTestId('fake-artplayer-engine')).toBeInTheDocument();
    expect(
      screen.queryByTestId('fake-vidstack-engine')
    ).not.toBeInTheDocument();
    expect(onEngineChange).toHaveBeenCalledTimes(1);
    expect(resolvePreference).toHaveBeenCalledTimes(1);
  });

  test('falls back from a fatal Vidstack playback failure once and restores its exact snapshot', async () => {
    const snapshot = {
      currentTime: 48,
      duration: 120,
      volume: 0.35,
      playbackRate: 1.5,
      paused: false,
    };
    const vidstackProps = jest.fn();
    const artplayerProps = jest.fn();
    const onEngineChange = jest.fn();
    const onSwitchingChange = jest.fn();
    const Vidstack = createFakeEngine(
      'fallback-vidstack-engine',
      { ...createFakeHandle(), getSnapshot: () => snapshot },
      vidstackProps
    );
    const ArtPlayer = createFakeEngine(
      'fallback-artplayer-engine',
      createFakeHandle(),
      artplayerProps
    );
    localStorage.setItem('preferredPlayer', 'vidstack');

    const view = render(
      <PlayerHost
        media={{ url: 'https://example.com/video.m3u8', title: 'Episode 1' }}
        urlOverride={null}
        engines={{ artplayer: ArtPlayer, vidstack: Vidstack }}
        resolvePreference={() => 'vidstack'}
        onEngineChange={onEngineChange}
        onSwitchingChange={onSwitchingChange}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('fallback-vidstack-engine')
      ).toBeInTheDocument();
    });

    act(() => {
      vidstackProps.mock.calls.at(-1)?.[0].onFailure({
        kind: 'playback',
        fatal: true,
        message: 'Vidstack 播放错误',
      });
    });

    expect(screen.getByRole('status')).toHaveTextContent(
      'Vidstack 播放失败，已临时切换到 ArtPlayer'
    );
    expect(screen.getByTestId('fallback-artplayer-engine')).toBeInTheDocument();
    expect(artplayerProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ restoreSnapshot: snapshot })
    );
    expect(onSwitchingChange).toHaveBeenNthCalledWith(1, true);
    expect(onEngineChange).toHaveBeenLastCalledWith(
      'artplayer',
      ARTPLAYER_CAPABILITIES
    );
    expect(localStorage.getItem('preferredPlayer')).toBe('vidstack');

    act(() =>
      artplayerProps.mock.calls.at(-1)?.[0].onReady(createFakeHandle())
    );
    expect(onSwitchingChange).toHaveBeenCalledTimes(1);

    act(() => artplayerProps.mock.calls.at(-1)?.[0].onCanPlay(snapshot));
    expect(onSwitchingChange).toHaveBeenNthCalledWith(2, false);
    act(() => artplayerProps.mock.calls.at(-1)?.[0].onCanPlay(snapshot));
    expect(onSwitchingChange).toHaveBeenCalledTimes(2);
    view.rerender(
      <PlayerHost
        media={{ url: 'https://example.com/next.m3u8', title: 'Episode 2' }}
        urlOverride={null}
        engines={{ artplayer: ArtPlayer, vidstack: Vidstack }}
        resolvePreference={() => 'vidstack'}
        onEngineChange={onEngineChange}
        onSwitchingChange={onSwitchingChange}
      />
    );
    expect(artplayerProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ restoreSnapshot: undefined })
    );
    const artplayerRenderCount = artplayerProps.mock.calls.length;

    act(() => {
      vidstackProps.mock.calls.at(-1)?.[0].onFailure({
        kind: 'playback',
        fatal: true,
        message: 'Vidstack 播放错误',
      });
    });

    expect(artplayerProps).toHaveBeenCalledTimes(artplayerRenderCount);
    expect(onEngineChange).toHaveBeenCalledTimes(2);
  });

  test('ignores delayed repeated fatal Vidstack failures after starting fallback', async () => {
    const vidstackProps = jest.fn();
    const Vidstack = createFakeEngine(
      'delayed-failure-vidstack-engine',
      createFakeHandle(),
      vidstackProps
    );
    const ArtPlayer = createFakeEngine(
      'delayed-failure-artplayer-engine',
      createFakeHandle()
    );
    const onFailure = jest.fn();
    const failure = {
      kind: 'playback' as const,
      fatal: true,
      message: 'Vidstack 播放错误',
    };

    render(
      <PlayerHost
        media={{ url: 'https://example.com/video.m3u8', title: 'Episode 1' }}
        urlOverride={null}
        engines={{ artplayer: ArtPlayer, vidstack: Vidstack }}
        resolvePreference={() => 'vidstack'}
        onFailure={onFailure}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('delayed-failure-vidstack-engine')
      ).toBeInTheDocument();
    });
    const oldVidstackProps = vidstackProps.mock.calls.at(-1)?.[0];

    act(() => oldVidstackProps.onFailure(failure));
    expect(
      screen.getByTestId('delayed-failure-artplayer-engine')
    ).toBeInTheDocument();

    act(() => oldVidstackProps.onFailure(failure));
    expect(onFailure).not.toHaveBeenCalled();
  });

  test('finishes fallback switching and discards a stale snapshot after the media URL changes', async () => {
    const snapshot = {
      currentTime: 48,
      duration: 120,
      volume: 0.35,
      playbackRate: 1.5,
      paused: true,
    };
    const vidstackProps = jest.fn();
    const artplayerProps = jest.fn();
    const onSwitchingChange = jest.fn();
    const Vidstack = createFakeEngine(
      'stale-fallback-vidstack-engine',
      { ...createFakeHandle(), getSnapshot: () => snapshot },
      vidstackProps
    );
    const ArtPlayer = createFakeEngine(
      'stale-fallback-artplayer-engine',
      createFakeHandle(),
      artplayerProps
    );
    const view = render(
      <PlayerHost
        media={{ url: 'https://example.com/failed.m3u8', title: 'Episode 1' }}
        urlOverride={null}
        engines={{ artplayer: ArtPlayer, vidstack: Vidstack }}
        resolvePreference={() => 'vidstack'}
        onSwitchingChange={onSwitchingChange}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('stale-fallback-vidstack-engine')
      ).toBeInTheDocument();
    });
    act(() =>
      vidstackProps.mock.calls.at(-1)?.[0].onFailure({
        kind: 'playback',
        fatal: true,
        message: 'Vidstack 播放错误',
      })
    );

    view.rerender(
      <PlayerHost
        media={{ url: 'https://example.com/current.m3u8', title: 'Episode 2' }}
        urlOverride={null}
        engines={{ artplayer: ArtPlayer, vidstack: Vidstack }}
        resolvePreference={() => 'vidstack'}
        onSwitchingChange={onSwitchingChange}
      />
    );
    expect(artplayerProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ restoreSnapshot: undefined })
    );

    act(() => artplayerProps.mock.calls.at(-1)?.[0].onCanPlay(snapshot));
    expect(onSwitchingChange).toHaveBeenNthCalledWith(2, false);
    act(() => artplayerProps.mock.calls.at(-1)?.[0].onCanPlay(snapshot));
    expect(onSwitchingChange).toHaveBeenCalledTimes(2);
  });

  test('does not fall back for remote Vidstack failures or an initial ArtPlayer failure', async () => {
    const vidstackProps = jest.fn();
    const artplayerProps = jest.fn();
    const Vidstack = createFakeEngine(
      'nonfatal-vidstack-engine',
      createFakeHandle(),
      vidstackProps
    );
    const ArtPlayer = createFakeEngine(
      'initial-artplayer-engine',
      createFakeHandle(),
      artplayerProps
    );
    const onFailure = jest.fn();
    render(
      <PlayerHost
        media={{ url: 'https://example.com/video.m3u8', title: 'Episode 1' }}
        urlOverride={null}
        engines={{ artplayer: ArtPlayer, vidstack: Vidstack }}
        resolvePreference={() => 'vidstack'}
        onFailure={onFailure}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('nonfatal-vidstack-engine')
      ).toBeInTheDocument();
    });
    const remoteFailure = {
      kind: 'remote-playback' as const,
      fatal: false,
      message: '远程播放错误',
    };
    act(() => vidstackProps.mock.calls.at(-1)?.[0].onFailure(remoteFailure));
    expect(screen.getByTestId('nonfatal-vidstack-engine')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(onFailure).toHaveBeenCalledWith(remoteFailure);
  });

  test('does not replace an initially selected ArtPlayer after its fatal failure', async () => {
    const artplayerProps = jest.fn();
    const ArtPlayer = createFakeEngine(
      'initial-artplayer-engine',
      createFakeHandle(),
      artplayerProps
    );
    const onFailure = jest.fn();
    render(
      <PlayerHost
        media={{ url: 'https://example.com/video.m3u8', title: 'Episode 1' }}
        urlOverride={null}
        engines={{ artplayer: ArtPlayer }}
        resolvePreference={() => 'artplayer'}
        onFailure={onFailure}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('initial-artplayer-engine')
      ).toBeInTheDocument();
    });
    const failure = {
      kind: 'playback' as const,
      fatal: true,
      message: '播放器初始化失败',
    };
    act(() => artplayerProps.mock.calls.at(-1)?.[0].onFailure(failure));

    expect(screen.getByTestId('initial-artplayer-engine')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(onFailure).toHaveBeenCalledWith(failure);
  });
});
