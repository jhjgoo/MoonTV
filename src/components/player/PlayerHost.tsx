'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

import { ArtPlayerEngine } from './ArtPlayerEngine';
import type {
  PlayerCapabilities,
  PlayerEngine,
  PlayerEngineComponent,
  PlayerEngineProps,
  PlayerEnhancements,
  PlayerFailure,
  PlayerHandle,
  PlayerMedia,
  PlayerSnapshot,
} from './player.types';
import { resolvePlayerPreference } from './player-preference';
import { VidstackEngine } from './VidstackEngine';

const noopTimeUpdate: PlayerEngineProps['onTimeUpdate'] = () => undefined;
const noopEnded: PlayerEngineProps['onEnded'] = () => undefined;
const noopPlay: PlayerEngineProps['onPlay'] = () => undefined;
const noopPause: PlayerEngineProps['onPause'] = () => undefined;
const EMPTY_SNAPSHOT: PlayerSnapshot = {
  currentTime: 0,
  duration: 0,
  volume: 0.7,
  playbackRate: 1,
  paused: true,
};
export const ARTPLAYER_CAPABILITIES = Object.freeze({
  airPlay: true,
  googleCast: false,
  adFiltering: true,
  skipConfig: true,
  mobileGestures: true,
});

export const VIDSTACK_CAPABILITIES = Object.freeze({
  airPlay: true,
  googleCast: true,
  adFiltering: false,
  skipConfig: false,
  mobileGestures: false,
});

const DEFAULT_ENGINES: Record<PlayerEngine, PlayerEngineComponent> = {
  artplayer: ArtPlayerEngine,
  vidstack: VidstackEngine,
};

function capabilitiesFor(engine: PlayerEngine): PlayerCapabilities {
  return engine === 'artplayer'
    ? ARTPLAYER_CAPABILITIES
    : VIDSTACK_CAPABILITIES;
}

export interface PlayerHostProps {
  enhancements?: PlayerEnhancements;
  media: PlayerMedia;
  urlOverride: string | null;
  restoreSnapshot?: PlayerSnapshot;
  onReady?: PlayerEngineProps['onReady'];
  onCanPlay?: PlayerEngineProps['onCanPlay'];
  onTimeUpdate?: PlayerEngineProps['onTimeUpdate'];
  onEnded?: PlayerEngineProps['onEnded'];
  onPlay?: PlayerEngineProps['onPlay'];
  onPause?: PlayerEngineProps['onPause'];
  onFailure?: (failure: PlayerFailure) => void;
  onEngineChange?: (
    engine: PlayerEngine,
    capabilities: PlayerCapabilities
  ) => void;
  onSwitchingChange?: (switching: boolean) => void;
  engines?: Partial<Record<PlayerEngine, PlayerEngineComponent>>;
  resolvePreference?: (
    urlOverride: string | null
  ) => PlayerEngine | Promise<PlayerEngine>;
}

export const PlayerHost = forwardRef<PlayerHandle, PlayerHostProps>(
  function PlayerHost(
    {
      enhancements,
      engines,
      media,
      onEngineChange,
      onCanPlay,
      onEnded,
      onFailure,
      onPause,
      onPlay,
      onReady,
      onTimeUpdate,
      onSwitchingChange,
      resolvePreference = resolvePlayerPreference,
      restoreSnapshot,
      urlOverride,
    },
    ref
  ) {
    const [engine, setEngine] = useState<PlayerEngine | null>(null);
    const [fallbackSnapshot, setFallbackSnapshot] = useState<PlayerSnapshot>();
    const [fallbackMediaUrl, setFallbackMediaUrl] = useState<string>();
    const [showFallbackNotice, setShowFallbackNotice] = useState(false);
    const engineRef = useRef<PlayerHandle>(null);
    const fallbackOccurredRef = useRef(false);
    const fallbackSwitchingRef = useRef(false);
    const initialResolution = useRef({
      onEngineChange,
      resolvePreference,
      urlOverride,
    });

    useImperativeHandle(ref, () => ({
      getSnapshot: () => engineRef.current?.getSnapshot() ?? EMPTY_SNAPSHOT,
      pause: () => engineRef.current?.pause(),
      play: () => engineRef.current?.play() ?? Promise.resolve(),
      seek: (time) => engineRef.current?.seek(time),
      setPlaybackRate: (playbackRate) =>
        engineRef.current?.setPlaybackRate(playbackRate),
      setVolume: (volume) => engineRef.current?.setVolume(volume),
      toggleFullscreen: () => engineRef.current?.toggleFullscreen(),
    }));

    useEffect(() => {
      let active = true;
      const {
        onEngineChange: initialOnEngineChange,
        resolvePreference: initialResolvePreference,
        urlOverride: initialUrlOverride,
      } = initialResolution.current;
      const selectEngine = (resolvedEngine: PlayerEngine) => {
        if (active) {
          setEngine(resolvedEngine);
          initialOnEngineChange?.(
            resolvedEngine,
            capabilitiesFor(resolvedEngine)
          );
        }
      };

      void Promise.resolve()
        .then(() => initialResolvePreference(initialUrlOverride))
        .then(selectEngine, () => selectEngine('artplayer'));

      return () => {
        active = false;
      };
    }, []);

    if (engine === null) {
      return <div aria-label='正在加载播放器' role='status' />;
    }

    const Engine = engines?.[engine] ?? DEFAULT_ENGINES[engine];
    const handleFailure: PlayerEngineProps['onFailure'] = (failure) => {
      if (
        engine === 'vidstack' &&
        failure.kind === 'playback' &&
        failure.fatal
      ) {
        if (fallbackOccurredRef.current) return;

        fallbackOccurredRef.current = true;
        fallbackSwitchingRef.current = true;
        const snapshot = engineRef.current?.getSnapshot() ?? EMPTY_SNAPSHOT;
        onSwitchingChange?.(true);
        setFallbackSnapshot(snapshot);
        setFallbackMediaUrl(media.url);
        setShowFallbackNotice(true);
        setEngine('artplayer');
        onEngineChange?.('artplayer', ARTPLAYER_CAPABILITIES);
        return;
      }

      onFailure?.(failure);
    };
    const handleReady: PlayerEngineProps['onReady'] = (handle) => {
      onReady?.(handle);
    };
    const handleCanPlay: NonNullable<PlayerEngineProps['onCanPlay']> = (
      snapshot
    ) => {
      onCanPlay?.(snapshot);
      if (engine === 'artplayer' && fallbackSwitchingRef.current) {
        fallbackSwitchingRef.current = false;
        setFallbackSnapshot(undefined);
        setFallbackMediaUrl(undefined);
        onSwitchingChange?.(false);
      }
    };

    return (
      <>
        {showFallbackNotice && (
          <div aria-live='polite' role='status'>
            Vidstack 播放失败，已临时切换到 ArtPlayer
          </div>
        )}
        <Engine
          ref={engineRef}
          enhancements={enhancements}
          media={media}
          restoreSnapshot={
            engine === 'artplayer' &&
            fallbackSnapshot &&
            fallbackMediaUrl === media.url
              ? fallbackSnapshot
              : restoreSnapshot
          }
          restoreSnapshotKind={
            engine === 'artplayer' &&
            fallbackSnapshot &&
            fallbackMediaUrl === media.url
              ? 'fallback'
              : 'resume'
          }
          onEnded={onEnded ?? noopEnded}
          onCanPlay={handleCanPlay}
          onFailure={handleFailure}
          onPause={onPause ?? noopPause}
          onPlay={onPlay ?? noopPlay}
          onReady={handleReady}
          onTimeUpdate={onTimeUpdate ?? noopTimeUpdate}
        />
      </>
    );
  }
);
