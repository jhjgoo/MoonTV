# Progressive Search Loading Implementation Plan

**执行状态：** 已完成（2026-07-21）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让搜索页在第一批结果返回后立即展示，并在首屏不足或用户滚动到底部时逐批加载剩余视频源。

**Architecture:** 保留 `/api/search?page=N` 和播放页全量搜索协议；在客户端导出单批请求函数，并新增独立的 `useProgressiveSearch` 状态机。搜索页使用 `IntersectionObserver` 监听底部哨兵，同一时间只请求一个批次，失败批次重试一次后跳过并允许手动重试。

**Tech Stack:** Next.js 14、React 18、TypeScript、Jest、Testing Library、IntersectionObserver

---

## 文件结构

- 修改 `src/lib/search.client.ts`：导出并校验单批搜索请求，保留全量搜索组合能力。
- 修改 `src/lib/search.client.test.ts`：覆盖单批协议、异常响应和全量搜索回归。
- 新建 `src/hooks/useProgressiveSearch.ts`：管理渐进搜索状态、排序去重、重试和取消。
- 新建 `src/hooks/useProgressiveSearch.test.tsx`：覆盖状态机、空批次、并发锁、失败重试和查询切换。
- 新建 `src/components/search/SearchLoadFooter.tsx`：渲染增量加载、耗尽、失败和手动降级入口。
- 新建 `src/components/search/SearchLoadFooter.test.tsx`：覆盖各类底部状态与按钮行为。
- 修改 `src/app/search/page.tsx`：接入状态机、底部哨兵和 `IntersectionObserver`。

### Task 1: 单批搜索客户端契约

**Files:**

- Modify: `src/lib/search.client.ts`
- Modify: `src/lib/search.client.test.ts`

- [x] **Step 1: 写单批请求失败测试**

在 `src/lib/search.client.test.ts` 中导入 `fetchSearchBatch`，新增：

```typescript
test('loads one requested server-side batch', async () => {
  const fetchImpl = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ results: [{ id: 'batch-2' }], totalPages: 4 }),
  });

  const batch = await fetchSearchBatch('金瓶梅', 2, fetchImpl as never);

  expect(batch.results[0].id).toBe('batch-2');
  expect(batch.totalPages).toBe(4);
  expect(fetchImpl).toHaveBeenCalledWith(
    `/api/search?q=${encodeURIComponent('金瓶梅')}&page=2`,
    { cache: 'no-store' }
  );
});

test('rejects malformed batch responses', async () => {
  const fetchImpl = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ results: 'invalid', totalPages: 0 }),
  });

  await expect(fetchSearchBatch('测试', 0, fetchImpl as never)).rejects.toThrow(
    '搜索响应格式错误'
  );
});
```

- [x] **Step 2: 运行测试并确认 RED**

Run: `rtk pnpm exec jest --runInBand --runTestsByPath src/lib/search.client.test.ts`

Expected: FAIL，因为 `fetchSearchBatch` 尚未导出且未校验响应。

- [x] **Step 3: 实现单批请求函数**

在 `src/lib/search.client.ts` 中导出响应类型和函数：

```typescript
export interface SearchBatchResponse {
  results: SearchResult[];
  totalPages: number;
}

export async function fetchSearchBatch(
  query: string,
  page: number,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<SearchBatchResponse> {
  const response = await fetchImpl(
    `/api/search?q=${encodeURIComponent(query.trim())}&page=${page}`,
    { cache: 'no-store', ...(signal ? { signal } : {}) }
  );
  if (!response.ok) throw new Error('搜索失败');

  const payload = (await response.json()) as Partial<SearchBatchResponse>;
  if (
    !Array.isArray(payload.results) ||
    !Number.isInteger(payload.totalPages) ||
    (payload.totalPages || 0) < 1
  ) {
    throw new Error('搜索响应格式错误');
  }
  return payload as SearchBatchResponse;
}
```

让 `fetchAllSearchResults()` 继续复用该函数，保持播放页行为不变。

- [x] **Step 4: 运行测试并确认 GREEN**

Run: `rtk pnpm exec jest --runInBand --runTestsByPath src/lib/search.client.test.ts`

Expected: PASS。

- [x] **Step 5: 提交**

```bash
rtk git add src/lib/search.client.ts src/lib/search.client.test.ts
rtk git commit -m "refactor(搜索): 导出单批搜索请求"
```

### Task 2: 渐进搜索状态机

**Files:**

- Create: `src/hooks/useProgressiveSearch.ts`
- Create: `src/hooks/useProgressiveSearch.test.tsx`

- [x] **Step 1: 写首批即时返回和单请求锁测试**

测试使用 `renderHook`、`act` 和可控 Promise，约定 Hook 接口：

```typescript
const { result, rerender } = renderHook(
  ({ query }) => useProgressiveSearch(query, fetchBatch),
  { initialProps: { query: '金瓶梅' } }
);

await act(async () => resolvePage(0, [{ source: 'safe', id: '1' }], 3));
expect(result.current.results).toHaveLength(1);
expect(result.current.nextPage).toBe(1);
expect(result.current.status).toBe('ready');

act(() => {
  void result.current.loadNext('auto');
  void result.current.loadNext('auto');
});
expect(fetchBatch).toHaveBeenCalledTimes(2); // 第 0 批 + 唯一的第 1 批
```

同时新增连续空批次测试：第 0 批和第 1 批均为空时，`nextPage` 必须依次推进，且 `hasMore` 保持正确。

- [x] **Step 2: 运行测试并确认 RED**

Run: `rtk pnpm exec jest --runInBand --runTestsByPath src/hooks/useProgressiveSearch.test.tsx`

Expected: FAIL，因为 Hook 文件不存在。

- [x] **Step 3: 实现基础状态机**

导出以下类型和接口：

```typescript
export type ProgressiveSearchStatus =
  | 'idle'
  | 'initial-loading'
  | 'auto-filling'
  | 'ready'
  | 'loading-more'
  | 'exhausted';

export interface ProgressiveSearchState {
  results: SearchResult[];
  status: ProgressiveSearchStatus;
  nextPage: number;
  totalPages: number;
  hasMore: boolean;
  failedPages: number[];
  loadNext: (mode: 'auto' | 'append') => Promise<void>;
  retryFailed: () => Promise<void>;
  restart: () => void;
}
```

实现要求：

- 查询词变化时中止旧请求、递增查询版本并请求第 0 批。
- `restart()` 使用相同查询词重新执行上述重置流程。
- `inFlightRef` 在请求开始前同步加锁，请求结束后释放。
- 成功或失败都推进 `nextPage`，避免空批次和坏批次卡住。
- 只有当前查询版本的响应可以写入状态。

- [x] **Step 4: 写排序、去重和查询取消测试**

覆盖：

```typescript
expect(mergeResults(existing, incoming, '金瓶梅', 'auto')).toEqual(
  expect.arrayContaining([...])
);
expect(
  mergeResults(existing, duplicateIncoming, '金瓶梅', 'append')
).toHaveLength(existing.length);
```

重新渲染为新查询词后，断言旧 `AbortSignal.aborted === true`，随后完成旧 Promise，结果仍不得写入新查询。

- [x] **Step 5: 运行新增测试并确认 RED**

Run: `rtk pnpm exec jest --runInBand --runTestsByPath src/hooks/useProgressiveSearch.test.tsx`

Expected: 新增排序、去重和取消测试 FAIL。

- [x] **Step 6: 实现混合排序和去重**

新增纯函数：

```typescript
export function mergeSearchResults(
  existing: SearchResult[],
  incoming: SearchResult[],
  query: string,
  mode: 'auto' | 'append'
): SearchResult[];
```

- 使用 `${result.source}:${result.id}` 去重。
- `auto` 模式合并后执行全量排序。
- `append` 模式只排序新批次，再追加到已有结果。
- 排序规则与当前搜索页一致：标题完全匹配优先、年份降序、同年按标题排序、`unknown` 最后。

- [x] **Step 7: 写失败重试测试**

覆盖首次失败后自动重试、第二次失败后加入 `failedPages` 并推进下一页，以及 `retryFailed()` 按页码顺序重试并合并成功结果。

- [x] **Step 8: 运行失败重试测试并确认 RED**

Run: `rtk pnpm exec jest --runInBand --runTestsByPath src/hooks/useProgressiveSearch.test.tsx`

Expected: FAIL，因为失败页逻辑尚未实现。

- [x] **Step 9: 实现失败重试并运行 GREEN**

每页最多尝试 2 次。两次失败后记录页码并继续。`retryFailed()` 同一时间只处理 1 个失败页，成功后从集合中删除。

Run: `rtk pnpm exec jest --runInBand --runTestsByPath src/hooks/useProgressiveSearch.test.tsx`

Expected: PASS。

- [x] **Step 10: 提交**

```bash
rtk git add src/hooks/useProgressiveSearch.ts src/hooks/useProgressiveSearch.test.tsx
rtk git commit -m "feat(搜索): 添加渐进搜索状态机"
```

### Task 3: 底部加载反馈组件

**Files:**

- Create: `src/components/search/SearchLoadFooter.tsx`
- Create: `src/components/search/SearchLoadFooter.test.tsx`

- [x] **Step 1: 写 UI 状态测试**

覆盖：

- 加载中显示「正在继续搜索其他视频源」。
- 正常耗尽显示「已加载全部结果」。
- 有失败页时显示「部分视频源加载失败」和重试按钮。
- `IntersectionObserver` 不可用且仍有下一页时显示「加载更多」按钮。

按钮测试必须断言 `onLoadMore`、`onRetryFailed` 各调用 1 次。

- [x] **Step 2: 运行测试并确认 RED**

Run: `rtk pnpm exec jest --runInBand --runTestsByPath src/components/search/SearchLoadFooter.test.tsx`

Expected: FAIL，因为组件不存在。

- [x] **Step 3: 实现组件**

组件接口固定为：

```typescript
interface SearchLoadFooterProps {
  status: ProgressiveSearchStatus;
  hasResults: boolean;
  hasMore: boolean;
  failedCount: number;
  observerSupported: boolean;
  onLoadMore: () => void;
  onRetryFailed: () => void;
}
```

组件只负责状态展示和按钮事件，不直接发请求。

- [x] **Step 4: 运行测试并确认 GREEN**

Run: `rtk pnpm exec jest --runInBand --runTestsByPath src/components/search/SearchLoadFooter.test.tsx`

Expected: PASS。

- [x] **Step 5: 提交**

```bash
rtk git add src/components/search/SearchLoadFooter.tsx src/components/search/SearchLoadFooter.test.tsx
rtk git commit -m "feat(搜索): 添加渐进加载状态反馈"
```

### Task 4: 搜索页接入底部哨兵

**Files:**

- Modify: `src/app/search/page.tsx`
- Test: `src/hooks/useProgressiveSearch.test.tsx`
- Test: `src/components/search/SearchLoadFooter.test.tsx`

- [x] **Step 1: 用渐进 Hook 替换全量搜索状态**

删除搜索页中的 `fetchAllSearchResults`、`isLoading`、`searchRequestRef` 和本地全量排序逻辑，改为：

```typescript
const query = searchParams.get('q') || '';
const progressive = useProgressiveSearch(query);
const searchResults = progressive.results;
const isInitialLoading = progressive.status === 'initial-loading';
```

保留同查询词重复提交能力，通过 Hook 的 `restart()` 重新开始，避免依赖页面内部请求函数。

- [x] **Step 2: 接入 `IntersectionObserver`**

新增 `sentinelRef`、`sentinelVisible` 和 `hasFilledViewportRef`：

```typescript
useEffect(() => {
  if (!sentinelRef.current || !('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver(
    ([entry]) => {
      setSentinelVisible(entry.isIntersecting);
      if (!entry.isIntersecting && progressive.results.length > 0) {
        hasFilledViewportRef.current = true;
      }
    },
    { root: document.body, rootMargin: '0px 0px 200px 0px' }
  );
  observer.observe(sentinelRef.current);
  return () => observer.disconnect();
}, [query, progressive.results.length]);
```

新增独立 effect：哨兵可见、仍有下一批且未加载时，调用 `loadNext(hasFilledViewportRef.current ? 'append' : 'auto')`。依赖 `nextPage` 和加载状态，确保连续空批次完成后仍能再次推进。

- [x] **Step 3: 接入页面反馈**

- 仅 `initial-loading` 使用中央加载动画。
- 第 0 批完成后立即渲染结果区。
- 仅在 `exhausted && results.length === 0` 时显示「未找到相关结果」。
- 在结果网格后渲染哨兵和 `SearchLoadFooter`。
- 查询词变化时重置 `hasFilledViewportRef`。

- [x] **Step 4: 运行定向测试**

Run:

```bash
rtk pnpm exec jest --runInBand --runTestsByPath \
  src/lib/search.client.test.ts \
  src/hooks/useProgressiveSearch.test.tsx \
  src/components/search/SearchLoadFooter.test.tsx \
  src/app/api/search/route.test.ts \
  src/lib/source-access.test.ts \
  src/lib/adult-keywords.test.ts
```

Expected: PASS，0 failures。

- [x] **Step 5: 静态检查与 Cloudflare 构建**

Run:

```bash
rtk pnpm exec prettier --check \
  src/lib/search.client.ts \
  src/lib/search.client.test.ts \
  src/hooks/useProgressiveSearch.ts \
  src/hooks/useProgressiveSearch.test.tsx \
  src/components/search/SearchLoadFooter.tsx \
  src/components/search/SearchLoadFooter.test.tsx \
  src/app/search/page.tsx
rtk git diff --check
rtk pnpm pages:build
```

Expected: 格式和 diff 检查通过；Cloudflare Pages 构建成功。仓库既有、与本次无关的 warning 单独记录。

- [x] **Step 6: 本地运行时验收**

重建 `moontv-subscription-acceptance` 容器并验证：

- 第一批完成后结果区立即出现。
- 第一批为空或不足一屏时继续请求下一页。
- 内容超过一屏后停止，滚动到底部才继续。
- 开启成人权限的管理员能在后续批次看到成人源。
- 关闭成人权限的用户搜索成人关键词仍为 0 条。

- [x] **Step 7: 提交**

```bash
rtk git add src/app/search/page.tsx
rtk git commit -m "feat(搜索): 支持滚动渐进加载结果"
```

### Task 5: 审查与完成验证

**Files:**

- Review: all changes since `b5a83bc`

- [x] **Step 1: 按规格逐项审查**

确认首批即时展示、首屏自动补足、滚动追加、失败重试、播放页不变和成人权限边界均有实现与测试证据。

- [x] **Step 2: 运行最终验证**

Run: Task 4 的完整定向测试、Prettier、`git diff --check` 和 `rtk pnpm pages:build`。

Expected: 所有定向测试通过，构建成功。

- [x] **Step 3: 检查提交历史和工作区**

Run:

```bash
rtk git status --short
rtk git log --oneline b5a83bc..HEAD
```

Expected: 工作区干净；提交按客户端、状态机、反馈组件、页面集成拆分。
