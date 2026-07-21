'use client';

/* eslint-disable @typescript-eslint/no-var-requires -- The app's CommonJS TypeScript config cannot statically import Vidstack's ESM-only exports. */

import {
  type ComponentType,
  type ForwardRefExoticComponent,
  type PropsWithoutRef,
  type ReactNode,
  type RefAttributes,
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
} from 'react';

import type {
  PlayerEngineProps,
  PlayerHandle,
  PlayerSnapshot,
} from './player.types';

interface VidstackMediaPlayerProps {
  autoPlay: boolean;
  children: ReactNode;
  className: string;
  crossOrigin: 'anonymous';
  playsInline: boolean;
  poster?: string;
  src: { src: string; type: 'application/x-mpegurl' };
  title: string;
  onCanPlay: () => void;
  onEnded: () => void;
  onError: (cause: unknown) => void;
  onPause: () => void;
  onPlay: () => void;
  onTimeUpdate: () => void;
}

interface MediaPlayerInstance {
  currentTime: number;
  duration: number;
  volume: number;
  playbackRate: number;
  paused: boolean;
  remotePlaybackType?: string;
  remotePlaybackState?: string;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  state?: { fullscreen?: boolean };
  play(): Promise<void>;
  pause(): Promise<void>;
  enterFullscreen(): Promise<void>;
  exitFullscreen(): Promise<void>;
}

interface VidstackControlProps {
  'aria-label': string;
  children: ReactNode;
  className: string;
}

const {
  MediaPlayer,
  MediaProvider,
  AirPlayButton,
  GoogleCastButton,
  AirPlayIcon,
  ChromecastIcon,
} = require('@vidstack/react') as {
  MediaPlayer: ForwardRefExoticComponent<
    PropsWithoutRef<VidstackMediaPlayerProps> &
      RefAttributes<MediaPlayerInstance>
  >;
  MediaProvider: ComponentType;
  AirPlayButton: ComponentType<VidstackControlProps>;
  GoogleCastButton: ComponentType<VidstackControlProps>;
  AirPlayIcon: ComponentType<{ className: string }>;
  ChromecastIcon: ComponentType<{ className: string }>;
};
const { DefaultVideoLayout, defaultLayoutIcons } =
  require('@vidstack/react/player/layouts/default') as {
    DefaultVideoLayout: ComponentType<{ icons: unknown; slots: unknown }>;
    defaultLayoutIcons: unknown;
  };

const remotePlaybackControls = {
  airPlayButton: (
    <AirPlayButton
      className='vds-airplay-button vds-button'
      aria-label='AirPlay'
    >
      <AirPlayIcon className='vds-icon' />
    </AirPlayButton>
  ),
  googleCastButton: (
    <GoogleCastButton
      className='vds-google-cast-button vds-button'
      aria-label='Google Cast'
    >
      <ChromecastIcon className='vds-icon' />
    </GoogleCastButton>
  ),
};

const EMPTY_SNAPSHOT: PlayerSnapshot = {
  currentTime: 0,
  duration: 0,
  volume: 0.7,
  playbackRate: 1,
  paused: true,
};

function snapshotFor(player: MediaPlayerInstance | null): PlayerSnapshot {
  if (!player) return EMPTY_SNAPSHOT;

  return {
    currentTime: player.currentTime || 0,
    duration: player.duration || 0,
    volume: player.volume ?? 0.7,
    playbackRate: player.playbackRate ?? 1,
    paused: player.paused ?? true,
  };
}

export const VidstackEngine = forwardRef<PlayerHandle, PlayerEngineProps>(
  function VidstackEngine(props, ref) {
    const playerRef = useRef<MediaPlayerInstance | null>(null);
    const propsRef = useRef(props);
    const restoredUrlRef = useRef<string | null>(null);
    propsRef.current = props;

    const handleRef = useRef<PlayerHandle>({
      getSnapshot: () => snapshotFor(playerRef.current),
      play: async () => {
        await playerRef.current?.play();
      },
      pause: () => {
        void playerRef.current?.pause();
      },
      seek: (time) => {
        if (playerRef.current) playerRef.current.currentTime = time;
      },
      setVolume: (volume) => {
        if (playerRef.current) playerRef.current.volume = volume;
      },
      setPlaybackRate: (playbackRate) => {
        if (playerRef.current) playerRef.current.playbackRate = playbackRate;
      },
      toggleFullscreen: async () => {
        const player = playerRef.current;
        if (!player) return;
        if (player.state?.fullscreen) {
          await player.exitFullscreen();
          return;
        }
        await player.enterFullscreen();
      },
    });
    useImperativeHandle(ref, () => handleRef.current, []);

    const handleCanPlay = () => {
      const player = playerRef.current;
      const currentProps = propsRef.current;
      if (!player) return;

      if (restoredUrlRef.current !== currentProps.media.url) {
        const restore =
          currentProps.restoreSnapshot ??
          (currentProps.media.initialTime
            ? {
                ...EMPTY_SNAPSHOT,
                currentTime: currentProps.media.initialTime,
                paused: false,
              }
            : undefined);
        if (restore) {
          player.currentTime = restore.currentTime;
          player.volume = restore.volume;
          player.playbackRate = restore.playbackRate;
          if (!restore.paused) void player.play();
        }
        restoredUrlRef.current = currentProps.media.url;
      }
      currentProps.onCanPlay?.(snapshotFor(player));
    };

    const handleError = (cause: unknown) => {
      const remotePlaybackType = playerRef.current?.remotePlaybackType;
      const remotePlaybackState = playerRef.current?.remotePlaybackState;
      if (
        remotePlaybackType &&
        remotePlaybackType !== 'none' &&
        remotePlaybackState !== 'disconnected'
      ) {
        propsRef.current.onFailure({
          kind: 'remote-playback',
          fatal: false,
          message: '远程播放错误',
          cause,
        });
        return;
      }

      propsRef.current.onFailure({
        kind: 'playback',
        fatal: true,
        message: 'Vidstack 播放错误',
        cause,
      });
    };

    const handleGoogleCastPromptError = useCallback((event: Event) => {
      const cause =
        event instanceof CustomEvent && event.detail !== undefined
          ? event.detail
          : event;
      propsRef.current.onFailure({
        kind: 'remote-playback',
        fatal: false,
        message: 'Google Cast 投屏失败',
        cause,
      });
    }, []);

    const handleRemotePlaybackChange = useCallback((event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : undefined;
      if (
        !detail ||
        typeof detail !== 'object' ||
        (detail as { state?: string }).state !== 'disconnected' ||
        (detail as { type?: string }).type === 'none'
      ) {
        return;
      }

      propsRef.current.onFailure({
        kind: 'remote-playback',
        fatal: false,
        message: '远程播放已断开',
        cause: detail,
      });
    }, []);

    const setPlayerRef = useCallback(
      (player: MediaPlayerInstance | null) => {
        const previousPlayer = playerRef.current;
        if (previousPlayer === player) return;

        previousPlayer?.removeEventListener(
          'google-cast-prompt-error',
          handleGoogleCastPromptError
        );
        previousPlayer?.removeEventListener(
          'remote-playback-change',
          handleRemotePlaybackChange
        );
        playerRef.current = player;

        if (player) {
          player.addEventListener(
            'google-cast-prompt-error',
            handleGoogleCastPromptError
          );
          player.addEventListener(
            'remote-playback-change',
            handleRemotePlaybackChange
          );
          propsRef.current.onReady(handleRef.current);
        }
      },
      [handleGoogleCastPromptError, handleRemotePlaybackChange]
    );

    return (
      <MediaPlayer
        ref={setPlayerRef}
        autoPlay={props.media.autoPlay ?? true}
        className='vidstack-player'
        crossOrigin='anonymous'
        playsInline
        poster={props.media.poster}
        src={{ src: props.media.url, type: 'application/x-mpegurl' }}
        title={props.media.title}
        onCanPlay={handleCanPlay}
        onEnded={() => propsRef.current.onEnded()}
        onError={handleError}
        onPause={() => propsRef.current.onPause(snapshotFor(playerRef.current))}
        onPlay={() => propsRef.current.onPlay(snapshotFor(playerRef.current))}
        onTimeUpdate={() =>
          propsRef.current.onTimeUpdate(snapshotFor(playerRef.current))
        }
      >
        <MediaProvider />
        <DefaultVideoLayout
          icons={defaultLayoutIcons}
          slots={remotePlaybackControls}
        />
      </MediaPlayer>
    );
  }
);
