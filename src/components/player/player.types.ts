import type {
  ForwardRefExoticComponent,
  PropsWithoutRef,
  RefAttributes,
} from 'react';

export type PlayerEngine = 'artplayer' | 'vidstack';

export interface PlayerMedia {
  url: string;
  title: string;
  poster?: string;
  initialTime?: number;
  autoPlay?: boolean;
}

export interface PlayerSnapshot {
  currentTime: number;
  duration: number;
  volume: number;
  playbackRate: number;
  paused: boolean;
}

export interface PlayerFailure {
  kind: 'playback' | 'remote-playback';
  fatal: boolean;
  message: string;
  cause?: unknown;
}

export interface PlayerCapabilities {
  readonly airPlay: boolean;
  readonly googleCast: boolean;
  readonly adFiltering: boolean;
  readonly skipConfig: boolean;
  readonly mobileGestures: boolean;
}

export interface PlayerHandle {
  play(): Promise<void>;
  pause(): void;
  seek(time: number): void;
  setVolume(volume: number): void;
  setPlaybackRate(playbackRate: number): void;
  toggleFullscreen(): Promise<void> | void;
  getSnapshot(): PlayerSnapshot;
}

export interface PlayerSkipConfig {
  enable: boolean;
  intro_time: number;
  outro_time: number;
}

export interface PlayerEnhancements {
  adFiltering?: {
    enabled: boolean;
    onChange: (value: boolean, snapshot: PlayerSnapshot) => void;
  };
  skip?: {
    config: PlayerSkipConfig;
    onChange: (config: PlayerSkipConfig) => void;
  };
  onNextEpisode?: () => boolean | void;
}

export interface PlayerEngineProps {
  media: PlayerMedia;
  restoreSnapshot?: PlayerSnapshot;
  enhancements?: PlayerEnhancements;
  onReady: (handle: PlayerHandle) => void;
  onCanPlay?: (snapshot: PlayerSnapshot) => void;
  onTimeUpdate: (snapshot: PlayerSnapshot) => void;
  onEnded: () => void;
  onPlay: (snapshot: PlayerSnapshot) => void;
  onPause: (snapshot: PlayerSnapshot) => void;
  onFailure: (failure: PlayerFailure) => void;
}

export type PlayerEngineComponent = ForwardRefExoticComponent<
  PropsWithoutRef<PlayerEngineProps> & RefAttributes<PlayerHandle>
>;
