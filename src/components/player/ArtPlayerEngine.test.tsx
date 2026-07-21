/* eslint-disable @typescript-eslint/no-explicit-any */

import { act, render } from '@testing-library/react';
import { createRef } from 'react';

import { ArtPlayerEngine, filterAdsFromM3U8 } from './ArtPlayerEngine';
import type { PlayerHandle } from './player.types';

const mockArtInstances: any[] = [];
const mockHlsInstances: any[] = [];
let mockArtConstructorError: unknown;

jest.mock('artplayer', () => {
  class MockArtplayer {
    static PLAYBACK_RATE: number[];
    static USE_RAF: boolean;
    config: any;
    video = document.createElement('video');
    currentTime = 12;
    duration = 120;
    volume = 0.7;
    playbackRate = 1;
    paused = false;
    fullscreen = false;
    switch = '';
    title = '';
    poster = '';
    notice = { show: '' };
    setting = { update: jest.fn() };
    events = new Map<string, (...args: any[]) => void>();
    destroy = jest.fn();
    pause = jest.fn(() => {
      this.paused = true;
    });
    play = jest.fn(async () => {
      this.paused = false;
    });

    constructor(config: any) {
      if (mockArtConstructorError) throw mockArtConstructorError;
      this.config = config;
      mockArtInstances.push(this);
    }

    on(name: string, callback: (...args: any[]) => void) {
      this.events.set(name, callback);
    }

    emit(name: string, ...args: any[]) {
      this.events.get(name)?.(...args);
    }
  }

  return { __esModule: true, default: MockArtplayer };
});

jest.mock('hls.js', () => {
  class MockLoader {
    load() {
      return undefined;
    }
  }
  class MockHls {
    static DefaultConfig = { loader: MockLoader };
    static Events = { ERROR: 'error' };
    static ErrorTypes = {
      NETWORK_ERROR: 'networkError',
      MEDIA_ERROR: 'mediaError',
    };
    events = new Map<string, (...args: any[]) => void>();
    destroy = jest.fn();
    startLoad = jest.fn();
    recoverMediaError = jest.fn();
    loadSource = jest.fn();
    attachMedia = jest.fn();
    constructor(public config: any) {
      mockHlsInstances.push(this);
    }
    on(name: string, callback: (...args: any[]) => void) {
      this.events.set(name, callback);
    }
    emit(name: string, ...args: any[]) {
      this.events.get(name)?.(...args);
    }
  }
  return { __esModule: true, default: MockHls };
});

describe('ArtPlayerEngine', () => {
  beforeEach(() => {
    mockArtInstances.length = 0;
    mockHlsInstances.length = 0;
    mockArtConstructorError = undefined;
  });

  afterEach(() => {
    delete (window as any).webkitConvertPointFromNodeToPage;
  });

  test('filters discontinuity markers without changing the remaining playlist', () => {
    expect(
      filterAdsFromM3U8('#EXTM3U\n#EXT-X-DISCONTINUITY\nsegment.ts\n')
    ).toBe('#EXTM3U\nsegment.ts\n');
  });

  test('initializes the preserved ArtPlayer defaults and exposes generic handle snapshots', async () => {
    const playerRef = createRef<PlayerHandle>();
    const onReady = jest.fn();
    const onTimeUpdate = jest.fn();
    const onPause = jest.fn();
    const { unmount } = render(
      <ArtPlayerEngine
        ref={playerRef}
        media={{
          url: 'https://example.com/episode.m3u8',
          title: '节目 - 第1集',
          poster: 'https://example.com/poster.jpg',
          autoPlay: true,
        }}
        onReady={onReady}
        onTimeUpdate={onTimeUpdate}
        onEnded={jest.fn()}
        onPlay={jest.fn()}
        onPause={onPause}
        onFailure={jest.fn()}
      />
    );

    const player = mockArtInstances[0];
    expect(player.config).toEqual(
      expect.objectContaining({
        url: 'https://example.com/episode.m3u8',
        poster: 'https://example.com/poster.jpg',
        autoplay: true,
        pip: true,
        setting: true,
        playbackRate: true,
        fullscreen: true,
        fullscreenWeb: true,
        playsInline: true,
        airplay: true,
        fastForward: true,
        autoOrientation: true,
        lock: true,
      })
    );

    act(() => {
      player.emit('ready');
      player.emit('video:timeupdate');
      player.emit('pause');
    });
    expect(onReady).toHaveBeenCalledWith(playerRef.current);
    expect(onTimeUpdate).toHaveBeenCalledWith({
      currentTime: 12,
      duration: 120,
      volume: 0.7,
      playbackRate: 1,
      paused: false,
    });
    expect(onPause).toHaveBeenCalledWith(
      expect.objectContaining({ duration: 120 })
    );
    playerRef.current?.seek(33);
    playerRef.current?.setVolume(0.3);
    playerRef.current?.setPlaybackRate(1.5);
    await playerRef.current?.play();
    playerRef.current?.pause();
    expect(player.currentTime).toBe(33);
    expect(player.volume).toBe(0.3);
    expect(player.playbackRate).toBe(1.5);
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.pause).toHaveBeenCalledTimes(1);
    unmount();
    expect(player.destroy).toHaveBeenCalledTimes(1);
  });

  test('keeps one ArtPlayer instance and switches its media outside WebKit', () => {
    const props = {
      media: { url: 'https://example.com/one.m3u8', title: '第一集' },
      onReady: jest.fn(),
      onTimeUpdate: jest.fn(),
      onEnded: jest.fn(),
      onPlay: jest.fn(),
      onPause: jest.fn(),
      onFailure: jest.fn(),
    };
    const view = render(<ArtPlayerEngine {...props} />);
    const first = mockArtInstances[0];

    view.rerender(
      <ArtPlayerEngine
        {...props}
        media={{ url: 'https://example.com/two.m3u8', title: '第二集' }}
      />
    );

    expect(mockArtInstances).toHaveLength(1);
    expect(first.switch).toBe('https://example.com/two.m3u8');
    expect(first.title).toBe('第二集');
    expect(first.destroy).not.toHaveBeenCalled();
  });

  test('reports canplay after a non-WebKit switch without waiting for a new ready event', () => {
    const onCanPlay = jest.fn();
    const props = {
      media: { url: 'https://example.com/one.m3u8', title: '第一集' },
      onReady: jest.fn(),
      onCanPlay,
      onTimeUpdate: jest.fn(),
      onEnded: jest.fn(),
      onPlay: jest.fn(),
      onPause: jest.fn(),
      onFailure: jest.fn(),
    };
    const view = render(<ArtPlayerEngine {...props} />);
    const player = mockArtInstances[0];

    view.rerender(
      <ArtPlayerEngine
        {...props}
        media={{ url: 'https://example.com/two.m3u8', title: '第二集' }}
      />
    );
    act(() => player.emit('video:canplay'));

    expect(props.onReady).not.toHaveBeenCalled();
    expect(onCanPlay).toHaveBeenCalledWith(
      expect.objectContaining({ currentTime: 12, duration: 120 })
    );
  });

  test('consumes a restore snapshot once per media URL instead of rewinding on later canplay events', () => {
    const view = render(
      <ArtPlayerEngine
        media={{ url: 'https://example.com/one.m3u8', title: '第一集' }}
        restoreSnapshot={{
          currentTime: 20,
          duration: 120,
          volume: 0.7,
          playbackRate: 1,
          paused: false,
        }}
        onReady={jest.fn()}
        onTimeUpdate={jest.fn()}
        onEnded={jest.fn()}
        onPlay={jest.fn()}
        onPause={jest.fn()}
        onFailure={jest.fn()}
      />
    );
    const player = mockArtInstances[0];

    act(() => player.emit('video:canplay'));
    expect(player.currentTime).toBe(20);
    player.currentTime = 68;
    act(() => player.emit('video:canplay'));
    expect(player.currentTime).toBe(68);

    view.rerender(
      <ArtPlayerEngine
        media={{ url: 'https://example.com/two.m3u8', title: '第二集' }}
        restoreSnapshot={{
          currentTime: 36,
          duration: 120,
          volume: 0.7,
          playbackRate: 1,
          paused: false,
        }}
        onReady={jest.fn()}
        onTimeUpdate={jest.fn()}
        onEnded={jest.fn()}
        onPlay={jest.fn()}
        onPause={jest.fn()}
        onFailure={jest.fn()}
      />
    );
    act(() => player.emit('video:canplay'));
    expect(player.currentTime).toBe(36);
  });

  test('restores the latest snapshot when ad filtering recreates the engine on the same URL', () => {
    Object.defineProperty(window, 'webkitConvertPointFromNodeToPage', {
      configurable: true,
      value: jest.fn(),
    });
    const callbacks = {
      onReady: jest.fn(),
      onTimeUpdate: jest.fn(),
      onEnded: jest.fn(),
      onPlay: jest.fn(),
      onPause: jest.fn(),
      onFailure: jest.fn(),
    };
    const media = { url: 'https://example.com/episode.m3u8', title: '第一集' };
    const view = render(
      <ArtPlayerEngine
        {...callbacks}
        media={media}
        restoreSnapshot={{
          currentTime: 12,
          duration: 120,
          volume: 0.7,
          playbackRate: 1,
          paused: false,
        }}
        enhancements={{ adFiltering: { enabled: false, onChange: jest.fn() } }}
      />
    );
    const first = mockArtInstances[0];
    act(() => first.emit('video:canplay'));
    first.currentTime = 44;
    first.volume = 0.3;
    first.playbackRate = 1.5;

    view.rerender(
      <ArtPlayerEngine
        {...callbacks}
        media={media}
        restoreSnapshot={{
          currentTime: 44,
          duration: 120,
          volume: 0.3,
          playbackRate: 1.5,
          paused: false,
        }}
        enhancements={{ adFiltering: { enabled: true, onChange: jest.fn() } }}
      />
    );
    const recreated = mockArtInstances[1];
    act(() => recreated.emit('video:canplay'));

    expect(recreated.currentTime).toBe(44);
    expect(recreated.volume).toBe(0.3);
    expect(recreated.playbackRate).toBe(1.5);
  });

  test('reports fatal initialization failures when ArtPlayer construction throws', () => {
    const cause = new Error('constructor failed');
    const onFailure = jest.fn();
    mockArtConstructorError = cause;

    render(
      <ArtPlayerEngine
        media={{ url: 'https://example.com/episode.m3u8', title: '第一集' }}
        onReady={jest.fn()}
        onTimeUpdate={jest.fn()}
        onEnded={jest.fn()}
        onPlay={jest.fn()}
        onPause={jest.fn()}
        onFailure={onFailure}
      />
    );

    expect(onFailure).toHaveBeenCalledWith({
      kind: 'playback',
      fatal: true,
      message: '播放器初始化失败',
      cause,
    });
  });

  test('updates mounted skip settings when enhancement configuration changes', () => {
    const onSkipChange = jest.fn();
    const props = {
      media: { url: 'https://example.com/episode.m3u8', title: '第一集' },
      enhancements: {
        skip: {
          config: { enable: true, intro_time: 12, outro_time: -34 },
          onChange: onSkipChange,
        },
      },
      onReady: jest.fn(),
      onTimeUpdate: jest.fn(),
      onEnded: jest.fn(),
      onPlay: jest.fn(),
      onPause: jest.fn(),
      onFailure: jest.fn(),
    };
    const view = render(<ArtPlayerEngine {...props} />);
    const player = mockArtInstances[0];
    player.setting.update.mockClear();

    view.rerender(
      <ArtPlayerEngine
        {...props}
        enhancements={{
          skip: {
            config: { enable: false, intro_time: 0, outro_time: 0 },
            onChange: onSkipChange,
          },
        }}
      />
    );

    expect(player.setting.update).toHaveBeenCalledWith(
      expect.objectContaining({ name: '跳过片头片尾', switch: false })
    );
    expect(player.setting.update).toHaveBeenCalledWith(
      expect.objectContaining({ name: '设置片头', tooltip: '设置片头时间' })
    );
    expect(player.setting.update).toHaveBeenCalledWith(
      expect.objectContaining({ name: '设置片尾', tooltip: '设置片尾时间' })
    );
  });

  test('rebuilds and tears down ArtPlayer when WebKit changes media', () => {
    Object.defineProperty(window, 'webkitConvertPointFromNodeToPage', {
      configurable: true,
      value: jest.fn(),
    });
    const props = {
      media: { url: 'https://example.com/one.m3u8', title: '第一集' },
      onReady: jest.fn(),
      onTimeUpdate: jest.fn(),
      onEnded: jest.fn(),
      onPlay: jest.fn(),
      onPause: jest.fn(),
      onFailure: jest.fn(),
    };
    const view = render(<ArtPlayerEngine {...props} />);
    const first = mockArtInstances[0];

    view.rerender(
      <ArtPlayerEngine
        {...props}
        media={{ url: 'https://example.com/two.m3u8', title: '第二集' }}
      />
    );

    expect(mockArtInstances).toHaveLength(2);
    expect(first.destroy).toHaveBeenCalledTimes(1);
  });

  test('maps ad filtering, skip configuration, and next episode controls to generic enhancements', () => {
    const onAdChange = jest.fn();
    const onSkipChange = jest.fn();
    const onNextEpisode = jest.fn();
    render(
      <ArtPlayerEngine
        media={{ url: 'https://example.com/episode.m3u8', title: '第一集' }}
        enhancements={{
          adFiltering: { enabled: true, onChange: onAdChange },
          skip: {
            config: { enable: false, intro_time: 12, outro_time: -34 },
            onChange: onSkipChange,
          },
          onNextEpisode,
        }}
        onReady={jest.fn()}
        onTimeUpdate={jest.fn()}
        onEnded={jest.fn()}
        onPlay={jest.fn()}
        onPause={jest.fn()}
        onFailure={jest.fn()}
      />
    );
    const player = mockArtInstances[0];

    expect(player.config.settings[3]).toEqual(
      expect.objectContaining({
        icon: expect.stringContaining('<svg'),
        tooltip: '00:12',
      })
    );
    expect(player.config.settings[4]).toEqual(
      expect.objectContaining({
        icon: expect.stringContaining('<svg'),
        tooltip: '-00:34',
      })
    );

    player.config.settings[0].onClick();
    player.config.settings[1].onSwitch({ switch: false });
    player.config.controls[0].click();

    expect(onAdChange).toHaveBeenCalledWith(false, expect.any(Object));
    expect(onSkipChange).toHaveBeenCalledWith({
      enable: true,
      intro_time: 12,
      outro_time: -34,
    });
    expect(onNextEpisode).toHaveBeenCalledTimes(1);
  });

  test('uses HLS recovery branches and tears down HLS with the player', () => {
    const onFailure = jest.fn();
    const { unmount } = render(
      <ArtPlayerEngine
        media={{ url: 'https://example.com/episode.m3u8', title: '第一集' }}
        enhancements={{ adFiltering: { enabled: true, onChange: jest.fn() } }}
        onReady={jest.fn()}
        onTimeUpdate={jest.fn()}
        onEnded={jest.fn()}
        onPlay={jest.fn()}
        onPause={jest.fn()}
        onFailure={onFailure}
      />
    );
    const player = mockArtInstances[0];
    player.config.customType.m3u8(player.video, player.config.url);
    const hls = mockHlsInstances[0];
    expect(hls.config.loader.name).toBe('CustomHlsJsLoader');
    act(() => {
      hls.emit('error', 'error', { fatal: true, type: 'networkError' });
      hls.emit('error', 'error', { fatal: true, type: 'mediaError' });
      hls.emit('error', 'error', { fatal: true, type: 'other' });
    });
    expect(hls.startLoad).toHaveBeenCalledTimes(1);
    expect(hls.recoverMediaError).toHaveBeenCalledTimes(1);
    expect(hls.destroy).toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ fatal: true })
    );
    unmount();
    expect(player.destroy).toHaveBeenCalledTimes(1);
  });
});
