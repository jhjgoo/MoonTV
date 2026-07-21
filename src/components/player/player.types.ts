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
  airPlay: boolean;
  googleCast: boolean;
  adFiltering: boolean;
  skipConfig: boolean;
  mobileGestures: boolean;
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

export interface PlayerEngineProps<TEnhancements = unknown> {
  media: PlayerMedia;
  restoreSnapshot?: PlayerSnapshot;
  enhancements?: TEnhancements;
  onReady: (handle: PlayerHandle) => void;
  onTimeUpdate: (snapshot: PlayerSnapshot) => void;
  onEnded: () => void;
  onPlay: (snapshot: PlayerSnapshot) => void;
  onPause: (snapshot: PlayerSnapshot) => void;
  onFailure: (failure: PlayerFailure) => void;
}
