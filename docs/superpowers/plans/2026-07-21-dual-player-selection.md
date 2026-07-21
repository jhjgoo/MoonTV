# Dual Player Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a browser-local ArtPlayer/Vidstack preference, keep ArtPlayer as the default full-featured engine, and provide experimental Vidstack playback with AirPlay, Google Cast, and one-time automatic fallback.

**Architecture:** `PlayPageClient` retains movie, episode, source, favorite, skip-config, and play-record business state. A client-only `PlayerHost` resolves URL/local preference once, mounts exactly one adapter behind a `PlayerHandle`, and owns the Vidstack-to-ArtPlayer fallback state machine. `ArtPlayerEngine` preserves the current ArtPlayer/HLS behavior; `VidstackEngine` maps Vidstack events and remote playback errors into the same small contract.

**Tech Stack:** Next.js 14, React 18, TypeScript 4.9, ArtPlayer 5.2.3, hls.js 1.6.6, `@vidstack/react` 1.12.13, Jest 27, Testing Library, Cloudflare Pages.

---

## File map

- Create `src/components/player/player.types.ts`: engine-independent media, snapshot, failure, capabilities, props, and imperative handle types.
- Create `src/components/player/player-preference.ts`: the only parser and localStorage access point for `preferredPlayer`.
- Create `src/components/player/player-preference.test.ts`: preference parsing, persistence, reset, and URL precedence tests.
- Create `src/components/UserMenu.test.tsx`: local-setting persistence, re-open, and reset coverage.
- Create `src/components/player/PlayerHost.tsx`: initial engine resolution, exclusive mounting, current-engine reporting, and one-time fallback state machine.
- Create `src/components/player/PlayerHost.test.tsx`: host hydration, selection, failure classification, snapshot transfer, and no-loop tests using injected fake engines.
- Create `src/components/player/ArtPlayerEngine.tsx`: existing ArtPlayer creation, HLS loader/recovery, AirPlay, skip controls, keyboard-compatible handle, and teardown.
- Create `src/components/player/ArtPlayerEngine.test.tsx`: adapter mapping and equivalent initialization/switch/teardown tests with mocked ArtPlayer and Hls.
- Create `src/components/player/VidstackEngine.tsx`: Vidstack HLS player, default controls, Cast controls, timeout, and unified event mapping.
- Create `src/components/player/VidstackEngine.test.tsx`: media props, controls, snapshot, local failure, remote failure, timeout, and cleanup tests.
- Create `src/components/player/vidstack-player.css`: scoped Vidstack base/theme imports and MoonTV container styling.
- Modify `src/components/UserMenu.tsx`: render and persist the two-option local player setting; reset it to ArtPlayer.
- Modify `src/app/play/page.tsx`: replace direct ArtPlayer refs and lifecycle with `PlayerHost` plus the unified handle while retaining one copy of page business logic.
- Create `src/app/play/page.test.tsx`: URL override wiring, generic player operations, episode/source continuity, and play-record regression tests.
- Modify `README.md`: document the local preference, URL override, browser support, and receiver-direct media limitation.
- Create `docs/testing/dual-player-device-matrix.md`: repeatable real-device acceptance matrix and failure classification.

## Contract fixed for every task

`PlayerSnapshot.duration` is intentionally added to the design's suggested snapshot because the existing play-record payload requires total duration. No provider-specific object crosses this boundary.

```ts
import type { ForwardRefExoticComponent, RefAttributes } from 'react';

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
  setPlaybackRate(rate: number): void;
  toggleFullscreen(): Promise<void> | void;
  getSnapshot(): PlayerSnapshot;
}
```

### Task 1: Player preference and local settings

**Files:**

- Create: `src/components/player/player-preference.ts`
- Create: `src/components/player/player-preference.test.ts`
- Create: `src/components/UserMenu.test.tsx`
- Modify: `src/components/UserMenu.tsx`

- [ ] **Step 1: Write the failing preference tests**

```ts
import {
  PLAYER_PREFERENCE_KEY,
  readPlayerPreference,
  resetPlayerPreference,
  resolvePlayerPreference,
  writePlayerPreference,
} from './player-preference';

beforeEach(() => localStorage.clear());

test.each([
  [null, 'artplayer'],
  ['legacy', 'artplayer'],
  ['artplayer', 'artplayer'],
  ['vidstack', 'vidstack'],
])('reads %p as %s', (stored, expected) => {
  if (stored !== null) localStorage.setItem(PLAYER_PREFERENCE_KEY, stored);
  expect(readPlayerPreference()).toBe(expected);
});

test('valid URL override wins without changing storage', () => {
  localStorage.setItem(PLAYER_PREFERENCE_KEY, 'artplayer');
  expect(resolvePlayerPreference('vidstack')).toBe('vidstack');
  expect(localStorage.getItem(PLAYER_PREFERENCE_KEY)).toBe('artplayer');
});

test('invalid URL override falls back to the valid local value', () => {
  localStorage.setItem(PLAYER_PREFERENCE_KEY, 'vidstack');
  expect(resolvePlayerPreference('unknown')).toBe('vidstack');
});

test('write and reset persist canonical values', () => {
  writePlayerPreference('vidstack');
  expect(readPlayerPreference()).toBe('vidstack');
  resetPlayerPreference();
  expect(readPlayerPreference()).toBe('artplayer');
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `rtk pnpm test -- --runInBand src/components/player/player-preference.test.ts`

Expected: FAIL because `./player-preference` does not exist.

- [ ] **Step 3: Implement the preference module**

```ts
import type { PlayerEngine } from './player.types';

export const PLAYER_PREFERENCE_KEY = 'preferredPlayer';

export function parsePlayerEngine(value: string | null): PlayerEngine | null {
  return value === 'artplayer' || value === 'vidstack' ? value : null;
}

export function readPlayerPreference(): PlayerEngine {
  if (typeof window === 'undefined') return 'artplayer';
  return (
    parsePlayerEngine(localStorage.getItem(PLAYER_PREFERENCE_KEY)) ??
    'artplayer'
  );
}

export function writePlayerPreference(value: PlayerEngine): void {
  if (typeof window !== 'undefined')
    localStorage.setItem(PLAYER_PREFERENCE_KEY, value);
}

export function resetPlayerPreference(): void {
  writePlayerPreference('artplayer');
}

export function resolvePlayerPreference(urlValue: string | null): PlayerEngine {
  return parsePlayerEngine(urlValue) ?? readPlayerPreference();
}
```

Also create `player.types.ts` initially with `PlayerEngine` so this module compiles; fill the remaining contract in Task 2.

- [ ] **Step 4: Run the preference tests and verify GREEN**

Run: `rtk pnpm test -- --runInBand src/components/player/player-preference.test.ts`

Expected: PASS, 7 cases.

- [ ] **Step 5: Write failing UserMenu behavior tests**

Mock `@/lib/auth` and `@/lib/version`, render `UserMenu`, open “设置”, and assert this behavior:

```ts
test('persists and restores the experimental player preference', () => {
  render(<UserMenu />);
  fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.click(screen.getByRole('radio', { name: /Vidstack/ }));
  expect(localStorage.getItem('preferredPlayer')).toBe('vidstack');

  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  expect(screen.getByRole('radio', { name: /Vidstack/ })).toBeChecked();
});

test('reset restores ArtPlayer', () => {
  localStorage.setItem('preferredPlayer', 'vidstack');
  render(<UserMenu />);
  fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.click(screen.getByRole('button', { name: '重置' }));
  expect(screen.getByRole('radio', { name: /ArtPlayer/ })).toBeChecked();
  expect(localStorage.getItem('preferredPlayer')).toBe('artplayer');
});
```

- [ ] **Step 6: Run UserMenu tests and verify RED**

Run: `rtk pnpm test -- --runInBand src/components/UserMenu.test.tsx`

Expected: FAIL because the player radio group is absent.

- [ ] **Step 7: Add the setting without live playback synchronization**

In `UserMenu.tsx`, initialize `preferredPlayer` to `'artplayer'`, read it with `readPlayerPreference()` in the existing local-settings effect, write it only from the radio change handler, and call `resetPlayerPreference()` from `handleResetSettings`. Add this field above the proxy divider:

```tsx
<fieldset>
  <legend className='text-sm font-medium text-gray-700 dark:text-gray-300'>
    默认播放器
  </legend>
  <div className='mt-2 space-y-2'>
    <label className='flex cursor-pointer items-start gap-2'>
      <input
        type='radio'
        name='preferred-player'
        value='artplayer'
        checked={preferredPlayer === 'artplayer'}
        onChange={() => handlePlayerChange('artplayer')}
      />
      <span>ArtPlayer（默认）</span>
    </label>
    <label className='flex cursor-pointer items-start gap-2'>
      <input
        type='radio'
        name='preferred-player'
        value='vidstack'
        checked={preferredPlayer === 'vidstack'}
        onChange={() => handlePlayerChange('vidstack')}
      />
      <span>
        Vidstack（实验性）
        <span className='block text-xs text-gray-500 dark:text-gray-400'>
          支持 AirPlay / Google Cast，部分播放增强功能暂不可用
        </span>
      </span>
    </label>
  </div>
</fieldset>
```

Do not add a `storage` event listener or dispatch a custom setting event; an already mounted play page therefore remains unchanged.

- [ ] **Step 8: Run focused tests and commit**

Run: `rtk pnpm test -- --runInBand src/components/player/player-preference.test.ts src/components/UserMenu.test.tsx`

Expected: PASS.

```bash
rtk git add src/components/player/player.types.ts src/components/player/player-preference.ts src/components/player/player-preference.test.ts src/components/UserMenu.tsx src/components/UserMenu.test.tsx
rtk git commit -m "feat(设置): 添加本地播放器偏好"
```

### Task 2: Unified player contract and host selection state

**Files:**

- Modify: `src/components/player/player.types.ts`
- Create: `src/components/player/PlayerHost.tsx`
- Create: `src/components/player/PlayerHost.test.tsx`

- [ ] **Step 1: Complete the contract and write host selection tests**

Add the contract fixed above plus:

```ts
export interface PlayerEngineProps {
  media: PlayerMedia;
  restoreSnapshot?: PlayerSnapshot;
  enhancements?: PlayerEnhancements;
  onReady(): void;
  onTimeUpdate(snapshot: PlayerSnapshot): void;
  onEnded(): void;
  onPlay(snapshot: PlayerSnapshot): void;
  onPause(snapshot: PlayerSnapshot): void;
  onFailure(failure: PlayerFailure): void;
}

export interface PlayerEnhancements {
  adFiltering: {
    enabled: boolean;
    onChange(value: boolean, snapshot: PlayerSnapshot): void;
  };
  skip: {
    config: { enable: boolean; intro_time: number; outro_time: number };
    onChange(config: PlayerEnhancements['skip']['config']): void;
  };
  onNextEpisode(): void;
}

export type PlayerEngineComponent = ForwardRefExoticComponent<
  PlayerEngineProps & RefAttributes<PlayerHandle>
>;
```

Use injected fake engines in `PlayerHost.test.tsx` so the state machine is independent of both third-party libraries:

```tsx
test('mounts no engine until the client preference is resolved', () => {
  const Art = fakeEngine('artplayer');
  const Vid = fakeEngine('vidstack');
  render(
    <PlayerHost
      media={media}
      urlOverride={null}
      engines={{ artplayer: Art, vidstack: Vid }}
    />
  );
  expect(screen.queryByTestId('artplayer')).not.toBeInTheDocument();
  expect(screen.queryByTestId('vidstack')).not.toBeInTheDocument();
});

test('URL override wins and exactly one engine is mounted', async () => {
  localStorage.setItem('preferredPlayer', 'artplayer');
  render(
    <PlayerHost media={media} urlOverride='vidstack' engines={fakeEngines} />
  );
  expect(await screen.findByTestId('vidstack')).toBeInTheDocument();
  expect(screen.queryByTestId('artplayer')).not.toBeInTheDocument();
  expect(localStorage.getItem('preferredPlayer')).toBe('artplayer');
});
```

In the first test, inject `resolvePreference={() => pending.promise}`. `resolvePreference` accepts `urlOverride` and returns `PlayerEngine | Promise<PlayerEngine>`; production defaults to `resolvePlayerPreference`. This seam tests the pre-resolution state without depending on React scheduling.

- [ ] **Step 2: Run host tests and verify RED**

Run: `rtk pnpm test -- --runInBand src/components/player/PlayerHost.test.tsx`

Expected: FAIL because `PlayerHost` does not exist.

- [ ] **Step 3: Implement selection-only PlayerHost**

```tsx
export const PlayerHost = forwardRef<PlayerHandle, PlayerHostProps>(
  (
    { media, urlOverride, engines = defaultEngines, onEngineChange, ...events },
    ref
  ) => {
    const engineRef = useRef<PlayerHandle>(null);
    const [engine, setEngine] = useState<PlayerEngine | null>(null);

    useEffect(() => {
      let active = true;
      Promise.resolve(resolvePreference(urlOverride)).then((selected) => {
        if (!active) return;
        setEngine(selected);
        onEngineChange?.(selected, capabilities[selected]);
      });
      return () => {
        active = false;
      };
      // Selection is deliberately mount-only.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        play: () => engineRef.current?.play() ?? Promise.resolve(),
        pause: () => engineRef.current?.pause(),
        seek: (time) => engineRef.current?.seek(time),
        setVolume: (volume) => engineRef.current?.setVolume(volume),
        setPlaybackRate: (rate) => engineRef.current?.setPlaybackRate(rate),
        toggleFullscreen: () => engineRef.current?.toggleFullscreen(),
        getSnapshot: () => engineRef.current?.getSnapshot() ?? EMPTY_SNAPSHOT,
      }),
      []
    );

    if (!engine)
      return <div aria-label='正在加载播放器' className='h-full bg-black' />;
    const Engine = engines[engine];
    return <Engine key={engine} ref={engineRef} media={media} {...events} />;
  }
);
```

Define immutable `ARTPLAYER_CAPABILITIES` and `VIDSTACK_CAPABILITIES` constants matching the design matrix. The fallback behavior remains absent until Task 6.

- [ ] **Step 4: Run host tests, typecheck, and commit**

Run: `rtk pnpm test -- --runInBand src/components/player/PlayerHost.test.tsx`

Expected: PASS for loading, local preference, URL override, invalid URL, and one-engine-only cases.

Run: `rtk pnpm typecheck`

Expected: PASS.

```bash
rtk git add src/components/player/player.types.ts src/components/player/PlayerHost.tsx src/components/player/PlayerHost.test.tsx
rtk git commit -m "feat(播放器): 建立统一宿主与引擎契约"
```

### Task 3: Equivalent ArtPlayer adapter extraction

**Files:**

- Create: `src/components/player/ArtPlayerEngine.tsx`
- Create: `src/components/player/ArtPlayerEngine.test.tsx`
- Modify: `src/app/play/page.tsx`
- Create: `src/app/play/page.test.tsx`

- [ ] **Step 1: Write RED adapter tests around current behavior**

Mock the ArtPlayer constructor with an event registry and observable `switch`, `destroy`, `video.hls`, `currentTime`, `duration`, `volume`, `playbackRate`, and `paused`. Assert:

```tsx
test('creates ArtPlayer with existing playback capabilities', () => {
  render(
    <ArtPlayerEngine
      ref={ref}
      media={media}
      {...events}
      enhancements={enhancements}
    />
  );
  expect(Artplayer).toHaveBeenCalledWith(
    expect.objectContaining({
      url: media.url,
      poster: media.poster,
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
});

test('maps events and tears down both HLS and ArtPlayer', () => {
  const { unmount } = render(
    <ArtPlayerEngine
      ref={ref}
      media={media}
      {...events}
      enhancements={enhancements}
    />
  );
  emit('video:timeupdate');
  expect(events.onTimeUpdate).toHaveBeenCalledWith(
    expect.objectContaining({ currentTime: 12, duration: 100 })
  );
  unmount();
  expect(hlsDestroy).toHaveBeenCalled();
  expect(playerDestroy).toHaveBeenCalled();
});
```

Add cases for non-WebKit URL switch, WebKit rebuild, HLS network recovery, HLS media recovery, unrecoverable HLS failure, skip intro/outro, next-episode control, ad-loader toggle, and unified handle operations.

- [ ] **Step 2: Run the adapter test and verify RED**

Run: `rtk pnpm test -- --runInBand src/components/player/ArtPlayerEngine.test.tsx`

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Extract ArtPlayer without changing its options or CSS**

Move the existing `ensureVideoSource`, `filterAdsFromM3U8`, `CustomHlsJsLoader`, ArtPlayer constructor options, settings, controls, event registration, WebKit rebuild branch, HLS recovery, and teardown from `src/app/play/page.tsx` into `ArtPlayerEngine.tsx`. Accept engine-independent enhancement features through:

```ts
const { adFiltering, skip, onNextEpisode } = enhancements;
```

Expose generic operations only:

```ts
useImperativeHandle(
  ref,
  () => ({
    play: () => playerRef.current?.play() ?? Promise.resolve(),
    pause: () => playerRef.current?.pause(),
    seek: (time) => {
      if (playerRef.current) playerRef.current.currentTime = time;
    },
    setVolume: (volume) => {
      if (playerRef.current) playerRef.current.volume = volume;
    },
    setPlaybackRate: (rate) => {
      if (playerRef.current) playerRef.current.playbackRate = rate;
    },
    toggleFullscreen: () => {
      if (playerRef.current)
        playerRef.current.fullscreen = !playerRef.current.fullscreen;
    },
    getSnapshot: () => snapshotOf(playerRef.current),
  }),
  []
);
```

The engine reports `onFailure({ kind: 'playback', fatal: true, ... })` only where the old page called `setError('播放器初始化失败')` or HLS recovery is exhausted. It must not own favorites, source lists, episode index, or play-record persistence.

- [ ] **Step 4: Write RED page tests for generic operations**

Mock `PlayerHost` with an imperative `PlayerHandle`. Verify source change reads `getSnapshot().currentTime`, keyboard arrows call `seek`/`setVolume`, space calls `play` or `pause` based on snapshot, `f` calls `toggleFullscreen`, episode changes save through the existing record function, and the rendered host receives one `PlayerMedia`.

```tsx
expect(playerHostProps.media).toEqual(
  expect.objectContaining({
    url: expect.any(String),
    title: expect.stringContaining('第'),
    poster: expect.any(String),
  })
);
```

- [ ] **Step 5: Replace direct page access with `PlayerHandle`**

Replace `artPlayerRef`/`artRef` with `playerRef`. Build `PlayerMedia` from `videoUrl`, the episode title, cover, `resumeTimeRef.current`, and autoplay. Render:

```tsx
<PlayerHost
  ref={playerRef}
  media={playerMedia}
  urlOverride={searchParams.get('player')}
  enhancements={{
    adFiltering: {
      enabled: blockAdEnabled,
      onChange: handleBlockAdChange,
    },
    skip: {
      config: skipConfig,
      onChange: handleSkipConfigChange,
    },
    onNextEpisode: handleNextEpisode,
  }}
  onReady={() => setError(null)}
  onTimeUpdate={handlePlayerTimeUpdate}
  onEnded={handleNextEpisodeIfAvailable}
  onPause={handlePlayerPause}
  onFailure={(failure) => failure.fatal && setError(failure.message)}
/>
```

Update `saveCurrentPlayProgress`, source continuity, keyboard shortcuts, and episode transitions to use `playerRef.current.getSnapshot()` and the generic methods. Keep record throttling in the page and ignore engine-switch events later through a host callback flag.

- [ ] **Step 6: Prove ArtPlayer equivalence before Vidstack work**

Run: `rtk pnpm test -- --runInBand src/components/player/ArtPlayerEngine.test.tsx src/components/player/PlayerHost.test.tsx src/app/play/page.test.tsx`

Expected: PASS.

Run: `rtk pnpm typecheck && rtk pnpm lint:strict`

Expected: PASS with no new warnings.

Manually compare the constructor option object and ArtPlayer event names against the fixed pre-implementation commit `f27e936`; every removed option or event must appear unchanged in `ArtPlayerEngine.tsx` or have an explicit page-level equivalent.

- [ ] **Step 7: Commit the completed equivalence slice**

```bash
rtk git add src/components/player/ArtPlayerEngine.tsx src/components/player/ArtPlayerEngine.test.tsx src/components/player/PlayerHost.tsx src/app/play/page.tsx src/app/play/page.test.tsx
rtk git commit -m "refactor(播放器): 等价提取 ArtPlayer 引擎"
```

### Task 4: Vidstack core playback

**Files:**

- Create: `src/components/player/VidstackEngine.tsx`
- Create: `src/components/player/VidstackEngine.test.tsx`
- Create: `src/components/player/vidstack-player.css`
- Modify: `src/components/player/PlayerHost.tsx`

- [ ] **Step 1: Write RED core playback tests**

Mock `@vidstack/react` components as semantic elements and capture `MediaPlayer` props. Assert HLS source metadata, title/poster/autoplay, default controls, event translation, initial snapshot restore, handle operations, and unmount cleanup:

```tsx
expect(mediaPlayerProps).toEqual(
  expect.objectContaining({
    src: { src: media.url, type: 'application/x-mpegurl' },
    title: media.title,
    poster: media.poster,
    autoPlay: true,
    playsInline: true,
  })
);
expect(screen.getByTestId('media-provider')).toBeInTheDocument();
expect(screen.getByTestId('default-video-layout')).toBeInTheDocument();
```

Emit `onCanPlay`, `onTimeUpdate`, `onPlay`, `onPause`, and `onEnded`; verify the unified callbacks and that `currentTime`, `volume`, and `playbackRate` are restored exactly once after can-play.

- [ ] **Step 2: Run the Vidstack test and verify RED**

Run: `rtk pnpm test -- --runInBand src/components/player/VidstackEngine.test.tsx`

Expected: FAIL because `VidstackEngine` does not exist.

- [ ] **Step 3: Implement the core Vidstack adapter**

Use the installed React package and default layout:

```tsx
<MediaPlayer
  ref={playerRef}
  src={{ src: media.url, type: 'application/x-mpegurl' }}
  title={media.title}
  poster={media.poster}
  autoPlay={media.autoPlay ?? true}
  playsInline
  crossOrigin
  onCanPlay={handleCanPlay}
  onTimeUpdate={handleTimeUpdate}
  onPlay={handlePlay}
  onPause={handlePause}
  onEnded={onEnded}
  onError={handleLocalError}
>
  <MediaProvider />
  <DefaultVideoLayout icons={defaultLayoutIcons} />
</MediaPlayer>
```

Import `@vidstack/react/player/styles/base.css`, `@vidstack/react/player/styles/default/theme.css`, and `@vidstack/react/player/styles/default/layouts/video.css` through `vidstack-player.css`. Scope MoonTV sizing and border radius under `.moontv-vidstack-player`; do not change the outer play-page dimensions.

Map the `MediaPlayerInstance` to `PlayerHandle`; catch rejected `play()` promises and emit a fatal local failure. Use `restoreSnapshot ?? media.initialTime` during the first can-play event and retain the latest values for `getSnapshot()`.

- [ ] **Step 4: Register Vidstack as the second real engine**

Replace the temporary default-engine placeholder in `PlayerHost.tsx`:

```ts
const defaultEngines: Record<PlayerEngine, PlayerEngineComponent> = {
  artplayer: ArtPlayerEngine,
  vidstack: VidstackEngine,
};
```

Keep dependency injection available to host tests.

- [ ] **Step 5: Run core tests and commit**

Run: `rtk pnpm test -- --runInBand src/components/player/VidstackEngine.test.tsx src/components/player/PlayerHost.test.tsx src/app/play/page.test.tsx`

Expected: PASS.

Run: `rtk pnpm typecheck`

Expected: PASS.

```bash
rtk git add src/components/player/VidstackEngine.tsx src/components/player/VidstackEngine.test.tsx src/components/player/vidstack-player.css src/components/player/PlayerHost.tsx
rtk git commit -m "feat(播放器): 增加 Vidstack 核心播放"
```

### Task 5: AirPlay, Google Cast, and remote-error classification

**Files:**

- Modify: `src/components/player/VidstackEngine.tsx`
- Modify: `src/components/player/VidstackEngine.test.tsx`
- Modify: `src/components/player/vidstack-player.css`
- Modify: `README.md`

- [ ] **Step 1: Write RED Cast control and classification tests**

Test that the layout includes both Vidstack controls and leaves Vidstack's `data-hidden` capability behavior intact. Dispatch `google-cast-prompt-error` on the underlying player element and simulate an `error` while `remotePlaybackType` is active, then assert:

```ts
expect(onFailure).toHaveBeenCalledWith(
  expect.objectContaining({
    kind: 'remote-playback',
    fatal: false,
  })
);
```

Then trigger `onError` and assert `kind: 'playback', fatal: true`. Verify a remote error does not call the local-error callback and does not unmount the MediaPlayer.

- [ ] **Step 2: Run the remote tests and verify RED**

Run: `rtk pnpm test -- --runInBand src/components/player/VidstackEngine.test.tsx -t "Cast|remote"`

Expected: FAIL because remote errors are not separately mapped.

- [ ] **Step 3: Add explicit Cast controls and error mapping**

Use `AirPlayButton` and `GoogleCastButton` in a custom `controls` slot if the default layout version does not expose both buttons in its active breakpoint. Keep buttons governed by Vidstack's `data-hidden` attributes:

```tsx
<AirPlayButton aria-label='AirPlay'><AirPlayIcon /></AirPlayButton>
<GoogleCastButton aria-label='Google Cast'><ChromecastIcon /></GoogleCastButton>
```

Do not infer support from user agent strings. Register and clean up a `google-cast-prompt-error` listener on the `MediaPlayerInstance`. In `onError`, inspect `playerRef.current?.state.remotePlaybackType`; if it is active, report a nonfatal remote failure, otherwise report a fatal local playback failure. User cancellation, unavailable devices, receiver load failure, and remote disconnect must never be passed as fatal local errors.

- [ ] **Step 4: Document receiver-direct behavior**

Add a README “播放器与投屏” section stating:

- ArtPlayer is default; Vidstack is experimental and browser-local.
- `?player=artplayer` and `?player=vidstack` override one page load.
- AirPlay/Google Cast buttons appear only when the browser/provider reports support.
- Chromecast/Google TV fetch the m3u8 directly and do not inherit browser Cookie, Referer, proxy, VPN, or the ArtPlayer ad-filter loader.
- HarmonyOS Cast+, DLNA, and Miracast are outside the Web implementation.

- [ ] **Step 5: Run tests, typecheck, and commit**

Run: `rtk pnpm test -- --runInBand src/components/player/VidstackEngine.test.tsx src/components/player/PlayerHost.test.tsx`

Expected: PASS.

Run: `rtk pnpm typecheck && rtk pnpm lint:strict`

Expected: PASS.

```bash
rtk git add src/components/player/VidstackEngine.tsx src/components/player/VidstackEngine.test.tsx src/components/player/vidstack-player.css README.md
rtk git commit -m "feat(投屏): 增加 AirPlay 与 Google Cast 控件"
```

### Task 6: One-time fallback and state restoration

**Files:**

- Modify: `src/components/player/PlayerHost.tsx`
- Modify: `src/components/player/PlayerHost.test.tsx`
- Modify: `src/components/player/VidstackEngine.tsx`
- Modify: `src/components/player/VidstackEngine.test.tsx`
- Modify: `src/app/play/page.tsx`
- Modify: `src/app/play/page.test.tsx`

- [ ] **Step 1: Write RED host fallback state-machine tests**

Cover all transitions with fake engines:

```tsx
test('falls back once with the latest snapshot and keeps preference', async () => {
  localStorage.setItem('preferredPlayer', 'vidstack');
  render(<PlayerHost media={media} urlOverride={null} engines={fakeEngines} />);
  failVidstack({ kind: 'playback', fatal: true, message: 'decode failed' });
  expect(await screen.findByTestId('artplayer')).toHaveAttribute(
    'data-restore',
    JSON.stringify(latestSnapshot)
  );
  expect(screen.getByRole('status')).toHaveTextContent(
    'Vidstack 播放失败，已临时切换到 ArtPlayer'
  );
  expect(localStorage.getItem('preferredPlayer')).toBe('vidstack');
  failArtplayer({ kind: 'playback', fatal: true, message: 'second failure' });
  expect(mountCounts.artplayer).toBe(1);
});

test('remote and recoverable failures never fall back', () => {
  failVidstack({ kind: 'remote-playback', fatal: false, message: 'cancelled' });
  expect(screen.getByTestId('vidstack')).toBeInTheDocument();
});
```

Add cases for ArtPlayer initially selected, a second Vidstack fatal signal, media changes after fallback, and `onSwitchingChange(true/false)` bracketing teardown/restoration so the page can suppress internal pause persistence.

- [ ] **Step 2: Run host fallback tests and verify RED**

Run: `rtk pnpm test -- --runInBand src/components/player/PlayerHost.test.tsx -t "fallback|remote|once"`

Expected: FAIL because fallback state is not implemented.

- [ ] **Step 3: Implement the one-way host transition**

Add `fallbackUsed`, `restoreSnapshot`, `switching`, and `actualEngine` state. The transition guard is exactly:

```ts
const shouldFallback =
  actualEngine === 'vidstack' &&
  !fallbackUsed &&
  failure.kind === 'playback' &&
  failure.fatal;
```

Before changing engine, read `engineRef.current?.getSnapshot()`, set `fallbackUsed`, notify `onSwitchingChange(true)`, and mount ArtPlayer with that snapshot. After ArtPlayer ready, call `onSwitchingChange(false)`, `onEngineChange('artplayer', ARTPLAYER_CAPABILITIES)`, and display one `role="status"` notice. Never write preference storage in this path.

- [ ] **Step 4: Add Vidstack's 20-second can-play watchdog**

Start or restart a timeout on every new `media.url`. Clear it on can-play, failure, URL change cleanup, and unmount. On expiry emit once:

```ts
onFailure({
  kind: 'playback',
  fatal: true,
  message: 'Vidstack 在 20 秒内未进入可播放状态',
});
```

Use Jest fake timers to verify can-play cancellation, URL-change restart, and cleanup. Recoverable buffering/waiting events must not invoke the fatal callback.

- [ ] **Step 5: Suppress engine-switch persistence in the page**

Maintain `engineSwitchingRef`. Page-level `onPause` and periodic time-update handlers return without saving while it is true. Immediately before fallback, persist the final valid snapshot once; after ArtPlayer ready, normal updates resume. Assert in `page.test.tsx` that the switch's internal pause does not create a duplicate `savePlayRecord` call.

- [ ] **Step 6: Run the complete player regression set and commit**

Run: `rtk pnpm test -- --runInBand src/components/player/player-preference.test.ts src/components/UserMenu.test.tsx src/components/player/PlayerHost.test.tsx src/components/player/ArtPlayerEngine.test.tsx src/components/player/VidstackEngine.test.tsx src/app/play/page.test.tsx`

Expected: PASS.

Run: `rtk pnpm typecheck && rtk pnpm lint:strict`

Expected: PASS.

```bash
rtk git add src/components/player/PlayerHost.tsx src/components/player/PlayerHost.test.tsx src/components/player/VidstackEngine.tsx src/components/player/VidstackEngine.test.tsx src/app/play/page.tsx src/app/play/page.test.tsx
rtk git commit -m "fix(播放器): Vidstack 失败时单次降级并恢复状态"
```

### Task 7: Full verification, Pages/Docker builds, and device acceptance

**Files:**

- Create: `docs/testing/dual-player-device-matrix.md`
- Modify: `README.md` only if verification exposes a deployment prerequisite that must be documented

- [ ] **Step 1: Create the real-device matrix**

Use a table with rows for iPhone/iPad Safari, Android Chrome, desktop Chrome, desktop Edge, Firefox, and HarmonyOS Browser. Columns must record browser version, ArtPlayer local playback, Vidstack local playback, AirPlay visibility/result, Google Cast visibility/result, play/pause, seek, episode change, disconnect recovery, play-record result, and categorized failure (`CORS`, codec, anti-hotlink, authentication, receiver network, unsupported browser).

Add ten anonymized real-source rows plus one public CORS-enabled HLS row. Do not include credentials, cookies, subscription links, or private tokens.

- [ ] **Step 2: Run the full automated suite**

Run: `rtk pnpm test -- --runInBand`

Expected: all suites and tests PASS; no open handles from HLS, watchdog timers, media listeners, or Cast sessions.

- [ ] **Step 3: Run static verification**

Run: `rtk pnpm typecheck`

Expected: PASS.

Run: `rtk pnpm lint:strict`

Expected: PASS with zero warnings.

Run: `rtk pnpm format:check`

Expected: PASS. If formatting fails, run `rtk pnpm format`, review only intended files, and rerun the check.

- [ ] **Step 4: Verify the production and Cloudflare Pages builds**

Run: `rtk pnpm build`

Expected: Next.js production build PASS and `/play` compiles as a client page under Suspense.

Run: `rtk pnpm pages:build`

Expected: Next.js plus `@cloudflare/next-on-pages` PASS; no Node-only import leaks into `PlayerHost` or either browser engine.

- [ ] **Step 5: Verify the Docker image**

Run: `rtk docker build -t moontv-dual-player:test .`

Expected: image build PASS.

Run the image with non-secret local test environment variables on an unused port, open `/play?...&player=artplayer` and `/play?...&player=vidstack`, verify each engine label/control surface, then stop and remove the test container. Never copy production credentials into the plan, logs, or commit.

- [ ] **Step 6: Perform the focused two-axis review**

Standards axis: check timer/listener/HLS cleanup, React effect dependency safety, ref freshness, inaccessible controls, provider objects leaking through the seam, and secret-bearing logs.

Specification axis: map every acceptance criterion in `docs/superpowers/specs/2026-07-21-dual-player-selection-design.md` to a passing test, build output, or a filled real-device matrix cell. Treat real-device Cast success as manual evidence only; do not claim it from JSDOM.

- [ ] **Step 7: Commit verification documentation**

```bash
rtk git add docs/testing/dual-player-device-matrix.md README.md
rtk git commit -m "docs(播放器): 添加双播放器验收矩阵"
```

Do not merge to `main` and do not push until the user has completed local acceptance and explicitly requests integration.
