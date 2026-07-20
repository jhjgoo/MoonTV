# Video Source Subscription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure Base58 video-source subscription import, normalized adult metadata, and on-demand source health checks to the MoonTV admin panel.

**Architecture:** Keep the existing source mutation route and add independent subscription and check routes with their own authorization flow. Concentrate source shape normalization, public-URL validation, subscription decoding, bounded fetching, and health probing in focused modules whose interfaces are also the primary test seams. Extract the existing video-source admin UI into a standalone module so its new state transitions can be tested without rendering the entire admin page.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Cloudflare Pages Edge runtime, D1/Redis/Upstash JSON admin configuration, Jest 27, Testing Library, Tailwind CSS.

---

## File map

- Create `src/lib/source.types.ts`: shared `ConfigApiSite`, `ApiSite`, and `AdminSource` interfaces.
- Create `src/lib/source-normalization.ts`: the single source normalization seam.
- Create `src/lib/source-normalization.test.ts`: source normalization regression tests.
- Modify `src/lib/admin.types.ts`: use `AdminSource[]` for `SourceConfig`.
- Modify `src/lib/config.ts`: distinguish file/runtime source types and normalize every source construction path.
- Create `src/lib/source-url.ts`: bounded public HTTPS URL validation.
- Create `src/lib/source-url.test.ts`: deterministic URL policy tests.
- Create `src/lib/source-fetch.ts`: redirect-aware streaming fetch with timeout and byte limits.
- Create `src/lib/source-fetch.test.ts`: response limit, redirect, and timeout tests.
- Create `src/lib/source-subscription.ts`: Base58 decode, JSON parse, item validation, caps, deduplication, and result construction.
- Create `src/lib/source-subscription.test.ts`: decoder and subscription import tests.
- Create `src/app/api/admin/source/subscription/route.ts`: independent subscription import route.
- Create `src/app/api/admin/source/subscription/route.test.ts`: route authorization and persistence tests.
- Create `src/lib/source-health.ts`: real-search protocol probe.
- Create `src/lib/source-health.test.ts`: healthy and unhealthy probe tests.
- Create `src/app/api/admin/source/check/route.ts`: independent health-check route.
- Create `src/app/api/admin/source/check/route.test.ts`: route authorization and lookup tests.
- Modify `src/app/api/admin/source/route.ts`: accept and normalize `adult` on individual add.
- Create `src/app/api/admin/source/route.test.ts`: individual-add adult normalization tests.
- Create `src/components/admin/VideoSourceConfig.tsx`: extracted source admin module with add, subscription, adult, and health UI.
- Create `src/components/admin/VideoSourceConfig.test.tsx`: UI state and request contract tests.
- Modify `src/app/admin/page.tsx`: remove the nested source module and render the extracted module.

### Task 1: Shared source model and normalization seam

**Files:**
- Create: `src/lib/source.types.ts`
- Create: `src/lib/source-normalization.ts`
- Test: `src/lib/source-normalization.test.ts`
- Modify: `src/lib/admin.types.ts`
- Modify: `src/lib/config.ts`

- [ ] **Step 1: Write failing normalization tests**

```ts
import {
  normalizeAdminSource,
  normalizeConfigSource,
} from './source-normalization';

describe('source normalization', () => {
  test.each([undefined, false, 'true', 1, null, [], {}])(
    'normalizes adult %p to false',
    (adult) => {
      expect(
        normalizeAdminSource({
          key: ' demo ',
          name: ' Demo ',
          api: ' https://example.com/api ',
          adult,
          from: 'custom',
        }).adult
      ).toBe(false);
    }
  );

  test('preserves strict adult true and operational fields', () => {
    expect(
      normalizeAdminSource({
        key: 'demo',
        name: 'Demo',
        api: 'https://example.com/api',
        adult: true,
        from: 'custom',
        disabled: true,
      })
    ).toMatchObject({ adult: true, from: 'custom', disabled: true });
  });

  test('creates config sources with a key and safe defaults', () => {
    expect(
      normalizeConfigSource('demo', {
        name: 'Demo',
        api: 'https://example.com/api',
      })
    ).toEqual({
      key: 'demo',
      name: 'Demo',
      api: 'https://example.com/api',
      detail: undefined,
      adult: false,
      from: 'config',
      disabled: false,
    });
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `pnpm test -- --runInBand src/lib/source-normalization.test.ts`

Expected: FAIL because `source-normalization` does not exist.

- [ ] **Step 3: Add shared types and minimal normalizers**

```ts
// src/lib/source.types.ts
export interface ConfigApiSite {
  name: string;
  api: string;
  detail?: string;
  adult?: boolean;
}

export interface ApiSite extends ConfigApiSite {
  key: string;
  adult: boolean;
}

export interface AdminSource extends ApiSite {
  from: 'config' | 'custom';
  disabled?: boolean;
}
```

```ts
// src/lib/source-normalization.ts
import { AdminSource, ConfigApiSite } from './source.types';

type SourceInput = Omit<AdminSource, 'adult'> & { adult?: unknown };

export function normalizeAdminSource(input: SourceInput): AdminSource {
  return {
    ...input,
    key: input.key.trim(),
    name: input.name.trim(),
    api: input.api.trim(),
    detail: input.detail?.trim() || undefined,
    adult: input.adult === true,
    disabled: input.disabled === true,
  };
}

export function normalizeConfigSource(
  key: string,
  input: ConfigApiSite
): AdminSource {
  return normalizeAdminSource({
    key,
    name: input.name,
    api: input.api,
    detail: input.detail,
    adult: input.adult,
    from: 'config',
    disabled: false,
  });
}
```

Update `AdminConfig.SourceConfig` to `AdminSource[]`. In every branch of `initConfig`, `getConfig`, and `resetConfig`, normalize persisted sources with `normalizeAdminSource` and file sources with `normalizeConfigSource`. Existing config sources keep their current `disabled` value when refreshed; newly created config sources use `false`.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `pnpm test -- --runInBand src/lib/source-normalization.test.ts`

Expected: PASS.

Run: `pnpm typecheck`

Expected: PASS after all source construction paths provide `adult`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/source.types.ts src/lib/source-normalization.ts src/lib/source-normalization.test.ts src/lib/admin.types.ts src/lib/config.ts
git commit -m "feat(视频源): 统一视频源类型与归一化"
```

### Task 2: Public URL policy and bounded fetch

**Files:**
- Create: `src/lib/source-url.ts`
- Test: `src/lib/source-url.test.ts`
- Create: `src/lib/source-fetch.ts`
- Test: `src/lib/source-fetch.test.ts`

- [ ] **Step 1: Write failing URL-policy tests**

Cover valid public HTTPS domains and rejection of HTTP, credentials, localhost, `.local`, IPv6 literals, and private/reserved IPv4 ranges including alternate URL spellings normalized by `URL`.

```ts
expect(validatePublicHttpsUrl('https://example.com/path').hostname).toBe(
  'example.com'
);
expect(() => validatePublicHttpsUrl('http://example.com')).toThrow('HTTPS');
expect(() => validatePublicHttpsUrl('https://127.0.0.1')).toThrow('公网');
expect(() => validatePublicHttpsUrl('https://192.168.1.1')).toThrow('公网');
expect(() => validatePublicHttpsUrl('https://user:pass@example.com')).toThrow(
  '凭据'
);
```

- [ ] **Step 2: Run URL tests and verify RED**

Run: `pnpm test -- --runInBand src/lib/source-url.test.ts`

Expected: FAIL because `validatePublicHttpsUrl` does not exist.

- [ ] **Step 3: Implement the URL interface**

Expose one interface:

```ts
export function validatePublicHttpsUrl(raw: string, maxLength = 2048): URL;
```

Use `new URL`, require `https:`, reject credentials and forbidden hostnames, reject all IP literals unless the implementation can prove they are public, and return the normalized `URL`. Document that DNS rebinding is outside the deterministic Edge-runtime policy.

- [ ] **Step 4: Write failing bounded-fetch tests**

Inject `fetchImpl` so tests control redirects and streaming bodies. Verify manual redirect validation, three-redirect limit, 10-second abort behavior with fake timers, early cancellation above the byte limit, and rejection of non-2xx terminal responses.

- [ ] **Step 5: Run fetch tests and verify RED**

Run: `pnpm test -- --runInBand src/lib/source-fetch.test.ts`

Expected: FAIL because `fetchTextWithLimits` does not exist.

- [ ] **Step 6: Implement streaming fetch**

```ts
export interface FetchTextOptions {
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
}

export async function fetchTextWithLimits(
  rawUrl: string,
  options: FetchTextOptions = {}
): Promise<string>;
```

Use `redirect: 'manual'`, validate every target, use one `AbortController`, read from `response.body.getReader()`, cancel immediately when accumulated bytes exceed the limit, and decode with `TextDecoder('utf-8', { fatal: true })`.

- [ ] **Step 7: Run focused tests and commit**

Run: `pnpm test -- --runInBand src/lib/source-url.test.ts src/lib/source-fetch.test.ts`

Expected: PASS.

```bash
git add src/lib/source-url.ts src/lib/source-url.test.ts src/lib/source-fetch.ts src/lib/source-fetch.test.ts
git commit -m "feat(视频源): 添加安全受限的订阅抓取"
```

### Task 3: Base58 subscription parser and import contract

**Files:**
- Create: `src/lib/source-subscription.ts`
- Test: `src/lib/source-subscription.test.ts`

- [ ] **Step 1: Write failing decoder and import tests**

Test valid Base58 JSON, invalid characters, empty input, invalid UTF-8, malformed JSON, missing `api_site`, 500-entry limit, key/name/URL length limits, explicit `adult: true`, non-boolean adult normalization, extra-field removal, duplicate skipping, unsafe API/Detail rejection, and fixed operational fields.

```ts
expect(result.sources[0]).toEqual({
  key: 'demo',
  name: 'Demo',
  api: 'https://example.com/api',
  detail: undefined,
  adult: false,
  from: 'custom',
  disabled: false,
});
```

- [ ] **Step 2: Run parser tests and verify RED**

Run: `pnpm test -- --runInBand src/lib/source-subscription.test.ts`

Expected: FAIL because the parser does not exist.

- [ ] **Step 3: Implement the small parser interface**

```ts
export interface SubscriptionFailure {
  key: string;
  reason: string;
}

export interface SubscriptionImportResult {
  sources: AdminSource[];
  added: number;
  skipped: number;
  failed: number;
  skippedItems: SubscriptionFailure[];
  failedItems: SubscriptionFailure[];
}

export function parseSourceSubscription(
  encoded: string,
  existingKeys: ReadonlySet<string>,
  existingCount: number
): SubscriptionImportResult;
```

Keep Base58 decoding internal, cap item details at 20 while retaining complete counts, reject batch-level structural/cap errors before returning, and use `validatePublicHttpsUrl` plus `normalizeAdminSource` for every accepted item.

- [ ] **Step 4: Run parser tests and commit**

Run: `pnpm test -- --runInBand src/lib/source-subscription.test.ts`

Expected: PASS.

```bash
git add src/lib/source-subscription.ts src/lib/source-subscription.test.ts
git commit -m "feat(视频源): 解析并校验 Base58 订阅"
```

### Task 4: Independent subscription route

**Files:**
- Create: `src/app/api/admin/source/subscription/route.ts`
- Test: `src/app/api/admin/source/subscription/route.test.ts`

- [ ] **Step 1: Write failing route tests**

Mock auth/config/storage and inject a mocked global fetch. Cover localStorage rejection, missing auth, non-admin rejection, owner/admin success, global fetch/parse failure without persistence, one `setAdminConfig` call for valid sources, and no write when zero sources are added.

- [ ] **Step 2: Run route tests and verify RED**

Run: `pnpm test -- --runInBand src/app/api/admin/source/subscription/route.test.ts`

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement the independent route**

The route accepts `{ url }`, repeats the existing storage/auth/role checks, calls `fetchTextWithLimits(url, { maxBytes: 1024 * 1024 })`, passes the text and existing Key set to `parseSourceSubscription`, appends accepted sources, persists once when `added > 0`, and returns counts plus capped details with `Cache-Control: no-store`.

- [ ] **Step 4: Run route tests and commit**

Run: `pnpm test -- --runInBand src/app/api/admin/source/subscription/route.test.ts`

Expected: PASS.

```bash
git add src/app/api/admin/source/subscription/route.ts src/app/api/admin/source/subscription/route.test.ts
git commit -m "feat(视频源): 添加独立订阅导入接口"
```

### Task 5: Health probe and independent check route

**Files:**
- Create: `src/lib/source-health.ts`
- Test: `src/lib/source-health.test.ts`
- Create: `src/app/api/admin/source/check/route.ts`
- Test: `src/app/api/admin/source/check/route.test.ts`

- [ ] **Step 1: Write failing health-probe tests**

Test HTTP 2xx with empty/non-empty list, non-2xx, timeout, invalid JSON, missing list, and non-array list. Assert every upstream failure returns `{ healthy: false, latencyMs, message }` instead of throwing to the UI.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm test -- --runInBand src/lib/source-health.test.ts`

Expected: FAIL because `checkSourceHealth` does not exist.

- [ ] **Step 3: Implement the probe**

```ts
export interface SourceHealthResult {
  healthy: boolean;
  latencyMs: number;
  message: string;
}

export async function checkSourceHealth(
  source: ApiSite,
  fetchImpl: typeof fetch = fetch
): Promise<SourceHealthResult>;
```

Build the URL with `API_CONFIG.search.path` and the fixed keyword `测试`, apply the existing search headers, use an 8-second `AbortController`, and validate only the protocol envelope (`list` array may be empty). Do not call `searchFromApi`, because it deliberately collapses upstream errors and empty results into the same empty array.

- [ ] **Step 4: Write route tests and implement the route**

The check route accepts `{ key }`, repeats storage/auth/role checks, looks up the server-side source by exact Key, returns 404 when absent, calls `checkSourceHealth`, and returns the structured result with `Cache-Control: no-store`. It never writes admin config.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm test -- --runInBand src/lib/source-health.test.ts src/app/api/admin/source/check/route.test.ts`

Expected: PASS.

```bash
git add src/lib/source-health.ts src/lib/source-health.test.ts src/app/api/admin/source/check/route.ts src/app/api/admin/source/check/route.test.ts
git commit -m "feat(视频源): 添加独立联调检测接口"
```

### Task 6: Individual adult field and extracted admin UI

**Files:**
- Modify: `src/app/api/admin/source/route.ts`
- Create: `src/app/api/admin/source/route.test.ts`
- Create: `src/components/admin/VideoSourceConfig.tsx`
- Test: `src/components/admin/VideoSourceConfig.test.tsx`
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: Write failing individual-add and UI tests**

Test that the existing add action stores strict `adult: true` and defaults all other values to false. Render the extracted UI and test mutually exclusive forms, unchecked adult default, adult submission, subscription loading/result summary, adult badges, checking/check-result/retry states, and reset of transient status when the component remounts.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm test -- --runInBand src/components/admin/VideoSourceConfig.test.tsx src/app/api/admin/source/route.test.ts`

Expected: FAIL because the extracted module and adult request contract do not exist.

- [ ] **Step 3: Extract the UI without changing existing behavior**

Move the current `VideoSourceConfig` and its local row renderer from `src/app/admin/page.tsx` into `src/components/admin/VideoSourceConfig.tsx`. Export this Props interface:

```ts
export interface VideoSourceConfigProps {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}
```

Import `AdminSource` instead of retaining the local `DataSource` interface. Preserve enable/disable/delete/sort and DnD behavior before adding new state.

- [ ] **Step 4: Add the new form and health states**

Use mutually exclusive `showAddForm` and `showSubscriptionForm` booleans. Add `subscriptionUrl`, `subscriptionPending`, `subscriptionResult`, and `healthByKey: Record<string, HealthViewState>` state. Individual add sends `adult`; subscription sends `{ url }` to `/api/admin/source/subscription`; check sends `{ key }` to `/api/admin/source/check`. Disable duplicate clicks while pending and keep health state outside `sources`.

- [ ] **Step 5: Update the existing add route**

Destructure `adult`, pass the full item through `normalizeAdminSource`, and preserve `from: 'custom'`, `disabled: false`.

- [ ] **Step 6: Run UI tests, typecheck, and commit**

Run: `pnpm test -- --runInBand src/components/admin/VideoSourceConfig.test.tsx`

Expected: PASS.

Run: `pnpm typecheck`

Expected: PASS.

```bash
git add src/app/api/admin/source/route.ts src/components/admin/VideoSourceConfig.tsx src/components/admin/VideoSourceConfig.test.tsx src/app/admin/page.tsx
git commit -m "feat(管理面板): 支持订阅导入与视频源检测"
```

### Task 7: Full verification and documentation alignment

**Files:**
- Modify only if verification exposes a concrete defect.

- [ ] **Step 1: Run the complete test suite**

Run: `pnpm test -- --runInBand`

Expected: all suites PASS with zero failures.

- [ ] **Step 2: Run static verification**

Run: `pnpm typecheck`

Expected: exit 0.

Run: `pnpm lint:strict`

Expected: exit 0 with zero warnings.

Run: `pnpm format:check`

Expected: exit 0.

- [ ] **Step 3: Run both production builds**

Run: `pnpm build`

Expected: Next.js production build exits 0.

Run: `pnpm pages:build`

Expected: Cloudflare Pages bundle generation exits 0 with Edge-compatible routes.

- [ ] **Step 4: Audit the implementation against the design**

Verify each acceptance criterion in `docs/superpowers/specs/2026-07-20-video-source-subscription-design.md`, including no persistent health state, one config write per successful import, strict adult normalization, bounded streaming fetch, imported API/Detail validation, and independent route authorization.

- [ ] **Step 5: Leave the worktree clean**

If verification required a concrete fix, rerun the command that exposed it, stage only the files changed for that defect, and commit with `fix(视频源): 修复订阅功能验证问题`. If no fix was required, do not create an empty verification commit.
