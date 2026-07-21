/* eslint-disable @typescript-eslint/no-explicit-any, no-console, react-hooks/exhaustive-deps */
'use client';

import Artplayer from 'artplayer';
import Hls from 'hls.js';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

import type {
  PlayerEngineProps,
  PlayerHandle,
  PlayerSkipConfig,
  PlayerSnapshot,
} from './player.types';

declare global {
  interface HTMLVideoElement {
    hls?: Hls;
  }
}

export function filterAdsFromM3U8(m3u8Content: string): string {
  if (!m3u8Content) return '';

  return m3u8Content
    .split('\n')
    .filter((line) => !line.includes('#EXT-X-DISCONTINUITY'))
    .join('\n');
}

export function ensureVideoSource(video: HTMLVideoElement | null, url: string) {
  if (!video || !url) return;

  const sources = Array.from(video.getElementsByTagName('source'));
  if (!sources.some((source) => source.src === url)) {
    sources.forEach((source) => source.remove());
    const source = document.createElement('source');
    source.src = url;
    video.appendChild(source);
  }
  video.disableRemotePlayback = false;
  if (video.hasAttribute('disableRemotePlayback')) {
    video.removeAttribute('disableRemotePlayback');
  }
}

function formatTime(seconds: number): string {
  if (seconds === 0) return '00:00';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (hours === 0) {
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds
      .toString()
      .padStart(2, '0')}`;
  }
  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

export class CustomHlsJsLoader extends Hls.DefaultConfig.loader {
  constructor(config: any) {
    super(config);
    const load = this.load.bind(this);
    this.load = function (context: any, loaderConfig: any, callbacks: any) {
      if (context.type === 'manifest' || context.type === 'level') {
        const onSuccess = callbacks.onSuccess;
        callbacks.onSuccess = function (
          response: any,
          stats: any,
          successContext: any
        ) {
          if (response.data && typeof response.data === 'string') {
            response.data = filterAdsFromM3U8(response.data);
          }
          return onSuccess(response, stats, successContext, null);
        };
      }
      load(context, loaderConfig, callbacks);
    };
  }
}

const EMPTY_SNAPSHOT: PlayerSnapshot = {
  currentTime: 0,
  duration: 0,
  volume: 0.7,
  playbackRate: 1,
  paused: true,
};

function snapshotFor(player: any): PlayerSnapshot {
  if (!player) return EMPTY_SNAPSHOT;
  return {
    currentTime: player.currentTime || 0,
    duration: player.duration || 0,
    volume: player.volume ?? 0.7,
    playbackRate: player.playbackRate ?? 1,
    paused: player.paused ?? true,
  };
}

export const ArtPlayerEngine = forwardRef<PlayerHandle, PlayerEngineProps>(
  function ArtPlayerEngine(props, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<any>(null);
    const hlsRef = useRef<Hls | null>(null);
    const propsRef = useRef(props);
    const preservedSnapshotRef = useRef<PlayerSnapshot | undefined>(
      props.restoreSnapshot
    );
    const restoredMediaUrlRef = useRef<string | null>(null);
    const lastSkipCheckRef = useRef(0);
    const previousAdFilteringRef = useRef<boolean | undefined>(
      props.enhancements?.adFiltering?.enabled
    );
    propsRef.current = props;

    const handleRef = useRef<PlayerHandle>({
      getSnapshot: () => snapshotFor(playerRef.current),
      pause: () => playerRef.current?.pause(),
      play: async () => {
        await Promise.resolve(playerRef.current?.play());
      },
      seek: (time) => {
        if (playerRef.current) playerRef.current.currentTime = time;
      },
      setPlaybackRate: (playbackRate) => {
        if (playerRef.current) playerRef.current.playbackRate = playbackRate;
      },
      setVolume: (volume) => {
        if (playerRef.current) playerRef.current.volume = volume;
      },
      toggleFullscreen: () => {
        if (playerRef.current) {
          playerRef.current.fullscreen = !playerRef.current.fullscreen;
        }
      },
    });
    useImperativeHandle(ref, () => handleRef.current, []);

    useEffect(() => {
      const container = containerRef.current;
      if (!container || !props.media.url) return;

      const isWebkit =
        typeof window !== 'undefined' &&
        typeof (window as any).webkitConvertPointFromNodeToPage === 'function';
      const adFilteringChanged =
        previousAdFilteringRef.current !==
        props.enhancements?.adFiltering?.enabled;
      previousAdFilteringRef.current = props.enhancements?.adFiltering?.enabled;
      const existingPlayer = playerRef.current;

      if (existingPlayer && !isWebkit && !adFilteringChanged) {
        existingPlayer.switch = props.media.url;
        existingPlayer.title = props.media.title;
        existingPlayer.poster = props.media.poster || '';
        ensureVideoSource(
          existingPlayer.video as HTMLVideoElement,
          props.media.url
        );
        return;
      }

      if (existingPlayer) {
        preservedSnapshotRef.current = snapshotFor(existingPlayer);
        hlsRef.current?.destroy();
        if (
          existingPlayer.video?.hls &&
          existingPlayer.video.hls !== hlsRef.current
        ) {
          existingPlayer.video.hls.destroy();
        }
        hlsRef.current = null;
        existingPlayer.destroy();
        playerRef.current = null;
      }

      let engine: any;
      try {
        Artplayer.PLAYBACK_RATE = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
        Artplayer.USE_RAF = true;
        engine = new Artplayer({
          container,
          url: props.media.url,
          poster: props.media.poster || '',
          volume: 0.7,
          isLive: false,
          muted: false,
          autoplay: props.media.autoPlay ?? true,
          pip: true,
          autoSize: false,
          autoMini: false,
          screenshot: false,
          setting: true,
          loop: false,
          flip: false,
          playbackRate: true,
          aspectRatio: false,
          fullscreen: true,
          fullscreenWeb: true,
          subtitleOffset: false,
          miniProgressBar: false,
          mutex: true,
          playsInline: true,
          autoPlayback: false,
          airplay: true,
          theme: '#22c55e',
          lang: 'zh-cn',
          hotkey: false,
          fastForward: true,
          autoOrientation: true,
          lock: true,
          moreVideoAttr: { crossOrigin: 'anonymous' },
          customType: {
            m3u8: (video: HTMLVideoElement, url: string) => {
              video.hls?.destroy();
              const hls = new Hls({
                debug: false,
                enableWorker: true,
                lowLatencyMode: true,
                maxBufferLength: 30,
                backBufferLength: 30,
                maxBufferSize: 60 * 1000 * 1000,
                loader: propsRef.current.enhancements?.adFiltering?.enabled
                  ? CustomHlsJsLoader
                  : Hls.DefaultConfig.loader,
              });
              hlsRef.current = hls;
              hls.loadSource(url);
              hls.attachMedia(video);
              video.hls = hls;
              ensureVideoSource(video, url);
              hls.on(Hls.Events.ERROR, (_event: any, data: any) => {
                if (!data.fatal) return;
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                  hls.startLoad();
                } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                  hls.recoverMediaError();
                } else {
                  hls.destroy();
                  propsRef.current.onFailure({
                    kind: 'playback',
                    fatal: true,
                    message: '无法恢复的 HLS 播放错误',
                    cause: data,
                  });
                }
              });
            },
          },
          icons: {
            loading:
              '<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MCIgaGVpZ2h0PSI1MCIgdmlld0JveD0iMCAwIDUwIDUwIj48cGF0aCBkPSJNMjUuMjUxIDYuNDYxYy0xMC4zMTggMC0xOC42ODMgOC4zNjUtMTguNjgzIDE4LjY4M2g0LjA2OGMwLTguMDcgNi41NDUtMTQuNjE1IDE0LjYxNS0xNC42MTVWNi40NjF6IiBmaWxsPSIjMDA5Njg4Ij48YW5pbWF0ZVRyYW5zZm9ybSBhdHRyaWJ1dGVOYW1lPSJ0cmFuc2Zvcm0iIGF0dHJpYnV0ZVR5cGU9IlhNTCIgZHVyPSIxcyIgZnJvbT0iMCAyNSAyNSIgcmVwZWF0Q291bnQ9ImluZGVmaW5pdGUiIHRvPSIzNjAgMjUgMjUiIHR5cGU9InJvdGF0ZSIvPjwvcGF0aD48L3N2Zz4=">',
          },
          settings: [
            {
              html: '去广告',
              icon: '<text x="50%" y="50%" font-size="20" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="#ffffff">AD</text>',
              tooltip: props.enhancements?.adFiltering?.enabled
                ? '已开启'
                : '已关闭',
              onClick() {
                const enabled =
                  !propsRef.current.enhancements?.adFiltering?.enabled;
                propsRef.current.enhancements?.adFiltering?.onChange(
                  enabled,
                  snapshotFor(engine)
                );
                return enabled ? '当前开启' : '当前关闭';
              },
            },
            {
              name: '跳过片头片尾',
              html: '跳过片头片尾',
              switch: props.enhancements?.skip?.config.enable,
              onSwitch(item: any) {
                const skip = propsRef.current.enhancements?.skip;
                if (!skip) return item.switch;
                const config = { ...skip.config, enable: !item.switch };
                skip.onChange(config);
                return config.enable;
              },
            },
            {
              html: '删除跳过配置',
              onClick() {
                propsRef.current.enhancements?.skip?.onChange({
                  enable: false,
                  intro_time: 0,
                  outro_time: 0,
                });
                return '';
              },
            },
            {
              name: '设置片头',
              html: '设置片头',
              icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L17 12" stroke="#ffffff" stroke-width="2"/><path d="M17 6L17 18" stroke="#ffffff" stroke-width="2"/></svg>',
              tooltip:
                props.enhancements?.skip?.config.intro_time === 0
                  ? '设置片头时间'
                  : formatTime(
                      props.enhancements?.skip?.config.intro_time ?? 0
                    ),
              onClick() {
                const skip = propsRef.current.enhancements?.skip;
                if (!skip || engine.currentTime <= 0) return undefined;
                const config: PlayerSkipConfig = {
                  ...skip.config,
                  intro_time: engine.currentTime,
                };
                skip.onChange(config);
                return formatTime(config.intro_time);
              },
            },
            {
              name: '设置片尾',
              html: '设置片尾',
              icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 6L7 18" stroke="#ffffff" stroke-width="2"/><path d="M7 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>',
              tooltip:
                (props.enhancements?.skip?.config.outro_time ?? 0) >= 0
                  ? '设置片尾时间'
                  : `-${formatTime(
                      -(props.enhancements?.skip?.config.outro_time ?? 0)
                    )}`,
              onClick() {
                const skip = propsRef.current.enhancements?.skip;
                const outroTime = -(engine.duration - engine.currentTime) || 0;
                if (!skip || outroTime >= 0) return undefined;
                const config = { ...skip.config, outro_time: outroTime };
                skip.onChange(config);
                return `-${formatTime(-config.outro_time)}`;
              },
            },
          ],
          controls: [
            {
              position: 'left',
              index: 13,
              html: '<i class="art-icon flex"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" fill="currentColor"/></svg></i>',
              tooltip: '播放下一集',
              click: () => propsRef.current.enhancements?.onNextEpisode?.(),
            },
          ],
        });
        playerRef.current = engine;

        engine.on('ready', () => {
          propsRef.current.onReady(handleRef.current);
        });
        engine.on('video:canplay', () => {
          const mediaUrl = propsRef.current.media.url;
          const restore =
            restoredMediaUrlRef.current === mediaUrl
              ? undefined
              : propsRef.current.restoreSnapshot ??
                preservedSnapshotRef.current ??
                (propsRef.current.media.initialTime
                  ? {
                      ...EMPTY_SNAPSHOT,
                      currentTime: propsRef.current.media.initialTime,
                      paused: false,
                    }
                  : undefined);
          if (restore) {
            let time = restore.currentTime;
            if (engine.duration && time >= engine.duration - 2) {
              time = Math.max(0, engine.duration - 5);
            }
            if (time > 0) engine.currentTime = time;
            engine.volume = restore.volume;
            if (isWebkit) engine.playbackRate = restore.playbackRate;
          }
          restoredMediaUrlRef.current = mediaUrl;
          preservedSnapshotRef.current = undefined;
          propsRef.current.onCanPlay?.(snapshotFor(engine));
        });
        engine.on('video:timeupdate', () => {
          const snapshot = snapshotFor(engine);
          propsRef.current.onTimeUpdate(snapshot);
          const skip = propsRef.current.enhancements?.skip?.config;
          const now = Date.now();
          if (!skip?.enable || now - lastSkipCheckRef.current < 1500) return;
          lastSkipCheckRef.current = now;
          if (skip.intro_time > 0 && snapshot.currentTime < skip.intro_time) {
            engine.currentTime = skip.intro_time;
            engine.notice.show = `已跳过片头 (${formatTime(skip.intro_time)})`;
          }
          if (
            skip.outro_time < 0 &&
            snapshot.duration > 0 &&
            snapshot.currentTime > snapshot.duration + skip.outro_time
          ) {
            const advanced = propsRef.current.enhancements?.onNextEpisode?.();
            if (!advanced) engine.pause();
            engine.notice.show = `已跳过片尾 (${formatTime(skip.outro_time)})`;
          }
        });
        engine.on('video:ended', () => propsRef.current.onEnded());
        engine.on('play', () => propsRef.current.onPlay(snapshotFor(engine)));
        engine.on('pause', () => propsRef.current.onPause(snapshotFor(engine)));
        engine.on('error', (cause: unknown) => {
          propsRef.current.onFailure({
            kind: 'playback',
            fatal: false,
            message: '播放器错误',
            cause,
          });
        });
        ensureVideoSource(engine.video as HTMLVideoElement, props.media.url);
      } catch (cause) {
        hlsRef.current?.destroy();
        if (engine?.video?.hls && engine.video.hls !== hlsRef.current) {
          engine.video.hls.destroy();
        }
        hlsRef.current = null;
        engine?.destroy();
        if (playerRef.current === engine) playerRef.current = null;
        propsRef.current.onFailure({
          kind: 'playback',
          fatal: true,
          message: '播放器初始化失败',
          cause,
        });
      }
    }, [props.media.url, props.enhancements?.adFiltering?.enabled]);

    useEffect(() => {
      const engine = playerRef.current;
      const skip = props.enhancements?.skip;
      if (!engine?.setting?.update || !skip) return;

      engine.setting.update({
        name: '跳过片头片尾',
        html: '跳过片头片尾',
        switch: skip.config.enable,
        onSwitch(item: any) {
          const currentSkip = propsRef.current.enhancements?.skip;
          if (!currentSkip) return item.switch;
          const config = {
            ...currentSkip.config,
            enable: !item.switch,
          };
          currentSkip.onChange(config);
          return config.enable;
        },
      });
      engine.setting.update({
        name: '设置片头',
        html: '设置片头',
        icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L17 12" stroke="#ffffff" stroke-width="2"/><path d="M17 6L17 18" stroke="#ffffff" stroke-width="2"/></svg>',
        tooltip:
          skip.config.intro_time === 0
            ? '设置片头时间'
            : formatTime(skip.config.intro_time),
      });
      engine.setting.update({
        name: '设置片尾',
        html: '设置片尾',
        icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 6L7 18" stroke="#ffffff" stroke-width="2"/><path d="M7 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>',
        tooltip:
          skip.config.outro_time >= 0
            ? '设置片尾时间'
            : `-${formatTime(-skip.config.outro_time)}`,
      });
    }, [props.enhancements?.skip?.config]);

    useEffect(() => {
      return () => {
        const engine = playerRef.current;
        if (!engine) return;
        hlsRef.current?.destroy();
        if (engine.video?.hls && engine.video.hls !== hlsRef.current) {
          engine.video.hls.destroy();
        }
        hlsRef.current = null;
        engine.destroy();
        playerRef.current = null;
      };
    }, []);

    return <div className='w-full h-full' ref={containerRef} />;
  }
);
