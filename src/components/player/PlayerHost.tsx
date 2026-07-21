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

const noopReady: PlayerEngineProps['onReady'] = () => undefined;
const noopTimeUpdate: PlayerEngineProps['onTimeUpdate'] = () => undefined;
const noopEnded: PlayerEngineProps['onEnded'] = () => undefined;
const noopPlay: PlayerEngineProps['onPlay'] = () => undefined;
const noopPause: PlayerEngineProps['onPause'] = () => undefined;
const noopFailure: PlayerEngineProps['onFailure'] = () => undefined;
const EMPTY_SNAPSHOT: PlayerSnapshot = {
  currentTime: 0,
  duration: 0,
  volume: 0.7,
  playbackRate: 1,
  paused: true,
};
const EMPTY_HANDLE: PlayerHandle = {
  getSnapshot: () => EMPTY_SNAPSHOT,
  pause: () => undefined,
  play: async () => undefined,
  seek: () => undefined,
  setPlaybackRate: () => undefined,
  setVolume: () => undefined,
  toggleFullscreen: () => undefined,
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

function createPlaceholderEngine(testId: string): PlayerEngineComponent {
  return forwardRef<PlayerHandle, PlayerEngineProps>(function PlaceholderEngine(
    _props,
    ref
  ) {
    useImperativeHandle(ref, () => EMPTY_HANDLE, []);

    return <div data-testid={testId} />;
  });
}

const DEFAULT_ENGINES: Record<PlayerEngine, PlayerEngineComponent> = {
  artplayer: ArtPlayerEngine,
  vidstack: createPlaceholderEngine('vidstack-engine'),
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
  onTimeUpdate?: PlayerEngineProps['onTimeUpdate'];
  onEnded?: PlayerEngineProps['onEnded'];
  onPlay?: PlayerEngineProps['onPlay'];
  onPause?: PlayerEngineProps['onPause'];
  onFailure?: (failure: PlayerFailure) => void;
  onEngineChange?: (
    engine: PlayerEngine,
    capabilities: PlayerCapabilities
  ) => void;
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
      onEnded,
      onFailure,
      onPause,
      onPlay,
      onReady,
      onTimeUpdate,
      resolvePreference = resolvePlayerPreference,
      restoreSnapshot,
      urlOverride,
    },
    ref
  ) {
    const [engine, setEngine] = useState<PlayerEngine | null>(null);
    const engineRef = useRef<PlayerHandle>(null);
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

    return (
      <Engine
        ref={engineRef}
        enhancements={enhancements}
        media={media}
        restoreSnapshot={restoreSnapshot}
        onEnded={onEnded ?? noopEnded}
        onFailure={onFailure ?? noopFailure}
        onPause={onPause ?? noopPause}
        onPlay={onPlay ?? noopPlay}
        onReady={onReady ?? noopReady}
        onTimeUpdate={onTimeUpdate ?? noopTimeUpdate}
      />
    );
  }
);
