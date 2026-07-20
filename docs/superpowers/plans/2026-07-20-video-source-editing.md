# 视频源编辑实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为自定义和订阅导入的视频源增加编辑模态框，同时保留内置源的快速启停操作。

**Architecture:** 扩展现有 `POST /api/admin/source`，新增 `update` action，在原数组位置归一化并替换自定义源。前端继续由 `VideoSourceConfig` 管理列表，在本地副本中编辑字段，通过模态框一次提交属性与启用状态；成功后刷新配置并清除旧检测结果。

**Tech Stack:** Next.js 14 App Router、React 18、TypeScript、Tailwind CSS、Jest、Testing Library、SweetAlert2

---

## 文件结构

- 修改 `src/app/api/admin/source/route.ts`：处理 `update` action、权限、校验和原位持久化。
- 修改 `src/app/api/admin/source/route.test.ts`：覆盖更新成功、字段归一化、权限和失败分支。
- 修改 `src/components/admin/VideoSourceConfig.tsx`：增加编辑状态、模态框、来源差异化操作和保存流程。
- 修改 `src/components/admin/VideoSourceConfig.test.tsx`：覆盖模态框、请求体、来源差异、成功与失败行为。

### Task 1：实现视频源更新 API

**Files:**

- Modify: `src/app/api/admin/source/route.ts`
- Test: `src/app/api/admin/source/route.test.ts`

- [ ] **Step 1：写入成功更新与字段保留的失败测试**

在 API 测试中创建包含前置源、目标自定义源和后置源的配置，发送：

```ts
{
  action: 'update',
  key: 'target',
  name: ' Updated ',
  api: ' https://updated.example.com/api ',
  detail: ' ',
  adult: true,
  disabled: true,
}
```

断言响应为 HTTP 200，目标条目变为：

```ts
{
  key: 'target',
  name: 'Updated',
  api: 'https://updated.example.com/api',
  detail: undefined,
  adult: true,
  disabled: true,
  from: 'custom',
}
```

同时断言数组 Key 顺序不变，且 `setAdminConfig` 只调用 1 次。再增加独立用例覆盖：

- 内置源更新返回 HTTP 400「该源不可编辑」。
- 未知 Key 返回 HTTP 404「源不存在」。
- 空白名称或 API 返回 HTTP 400「缺少必要参数」。
- `adult: 'true'` 与 `disabled: 1` 均归一化为 `false`。
- 所有失败分支均不调用 `setAdminConfig`。

现有路由权限测试已经覆盖未登录与非管理员请求；在更新用例中复用相同身份夹具，确认
`update` 不绕过既有权限判断。

- [ ] **Step 2：运行测试并确认因缺少 update action 失败**

Run:

```bash
rtk pnpm test --runInBand src/app/api/admin/source/route.test.ts
```

Expected: FAIL，响应为 HTTP 400「参数格式错误」。

- [ ] **Step 3：实现最小 update action**

把 Action 和允许动作列表加入 `update`：

```ts
type Action = 'add' | 'update' | 'disable' | 'enable' | 'delete' | 'sort';

const ACTIONS: Action[] = [
  'add',
  'update',
  'disable',
  'enable',
  'delete',
  'sort',
];
```

在 switch 中增加：

```ts
case 'update': {
  const { key, name, api, detail, adult, disabled } = body as {
    key?: string;
    name?: string;
    api?: string;
    detail?: string;
    adult?: unknown;
    disabled?: unknown;
  };
  if (
    typeof key !== 'string' ||
    typeof name !== 'string' ||
    typeof api !== 'string' ||
    !key.trim() ||
    !name.trim() ||
    !api.trim()
  ) {
    return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
  }
  const index = adminConfig.SourceConfig.findIndex(
    (source) => source.key === key
  );
  if (index === -1) {
    return NextResponse.json({ error: '源不存在' }, { status: 404 });
  }
  const current = adminConfig.SourceConfig[index];
  if (current.from === 'config') {
    return NextResponse.json({ error: '该源不可编辑' }, { status: 400 });
  }
  adminConfig.SourceConfig[index] = normalizeAdminSource({
    key: current.key,
    name,
    api,
    detail,
    adult,
    disabled,
    from: current.from,
  });
  break;
}
```

- [ ] **Step 4：运行 API 测试并确认成功更新测试通过**

Run:

```bash
rtk pnpm test --runInBand src/app/api/admin/source/route.test.ts
```

Expected: PASS。

- [ ] **Step 5：提交 API 切片**

```bash
rtk git add src/app/api/admin/source/route.ts src/app/api/admin/source/route.test.ts
rtk git commit -m "feat(视频源): 支持更新自定义源"
```

### Task 2：实现编辑模态框与来源差异化操作

**Files:**

- Modify: `src/components/admin/VideoSourceConfig.tsx`
- Test: `src/components/admin/VideoSourceConfig.test.tsx`

- [ ] **Step 1：写入操作按钮和模态框预填的失败测试**

在组件测试中断言：

```ts
expect(
  screen.getByRole('button', { name: '编辑 adult-source' })
).toBeInTheDocument();
expect(
  screen.queryByRole('button', { name: '编辑 general-source' })
).not.toBeInTheDocument();
expect(
  screen.getByRole('button', { name: '禁用 general-source' })
).toBeInTheDocument();
expect(
  screen.queryByRole('button', { name: '禁用 adult-source' })
).not.toBeInTheDocument();
```

点击自定义源编辑按钮后，断言标题、名称、Key、API、Detail、成人属性和启用状态均已预填，并断言 Key 输入框为只读。另行断言取消、关闭按钮、遮罩和 Esc 均可关闭弹窗且不发送请求，关闭后焦点回到编辑按钮。

- [ ] **Step 2：运行组件测试并确认缺少编辑按钮而失败**

Run:

```bash
rtk pnpm test --runInBand src/components/admin/VideoSourceConfig.test.tsx
```

Expected: FAIL，找不到「编辑 adult-source」按钮。

- [ ] **Step 3：实现编辑状态与差异化操作**

增加状态：

```ts
const [editingSource, setEditingSource] = useState<AdminSource | null>(null);
const [savingEdit, setSavingEdit] = useState(false);
```

操作区规则：

```tsx
{
  source.from === 'config' ? (
    <button
      aria-label={`${source.disabled ? '启用' : '禁用'} ${source.key}`}
      onClick={() => handleToggleEnable(source.key)}
    >
      {source.disabled ? '启用' : '禁用'}
    </button>
  ) : (
    <>
      <button
        aria-label={`编辑 ${source.key}`}
        onClick={() => setEditingSource({ ...source })}
      >
        编辑
      </button>
      <button onClick={() => handleDelete(source.key)}>删除</button>
    </>
  );
}
```

编辑表单直接绑定 `editingSource` 的副本，不修改 `sources` 或 `config.SourceConfig`。

- [ ] **Step 4：实现可访问模态框的最小结构**

模态框必须包含：

```tsx
<div role='dialog' aria-modal='true' aria-labelledby='edit-source-title'>
  <h3 id='edit-source-title'>编辑视频源</h3>
  <input aria-label='名称' value={editingSource.name} />
  <input aria-label='Key' value={editingSource.key} readOnly />
  <input aria-label='API 地址' value={editingSource.api} />
  <input aria-label='Detail 地址' value={editingSource.detail || ''} />
  <input
    type='checkbox'
    aria-label='🔞 成人内容源'
    checked={editingSource.adult}
  />
  <input
    type='checkbox'
    aria-label='启用此视频源'
    checked={!editingSource.disabled}
  />
  <button>取消</button>
  <button>保存修改</button>
</div>
```

同时实现关闭按钮、遮罩关闭、Esc 关闭、首个可编辑字段聚焦和关闭后的焦点归还。

- [ ] **Step 5：运行组件测试并确认预填与来源规则通过**

Run:

```bash
rtk pnpm test --runInBand src/components/admin/VideoSourceConfig.test.tsx
```

Expected: 操作按钮和预填测试 PASS。

- [ ] **Step 6：写入保存请求和并发保护的失败测试**

修改名称、API、Detail、成人属性和启用状态后点击「保存修改」，断言：

```ts
expect(fetchMock).toHaveBeenCalledWith(
  '/api/admin/source',
  expect.objectContaining({
    method: 'POST',
    body: JSON.stringify({
      action: 'update',
      key: 'adult-source',
      name: 'Updated source',
      api: 'https://updated.example.com/api',
      detail: 'https://updated.example.com/detail',
      adult: false,
      disabled: true,
    }),
  })
);
```

请求未完成时，断言按钮显示「保存中…」且不可点击，关闭按钮、遮罩和 Esc 都不能关闭模态框。再分别覆盖：

- 保存成功：调用 `refreshConfig`，关闭模态框，旧检测状态回到「未检测」。
- 保存失败：不调用 `refreshConfig`，模态框和输入保留，旧检测结果保留。

- [ ] **Step 7：运行组件测试并确认因缺少保存处理而失败**

Run:

```bash
rtk pnpm test --runInBand src/components/admin/VideoSourceConfig.test.tsx
```

Expected: FAIL，未调用 `fetch` 或未出现「保存中…」。

- [ ] **Step 8：实现保存流程**

实现：

```ts
const handleSaveEdit = async () => {
  if (!editingSource || savingEdit) return;
  if (!editingSource.name.trim() || !editingSource.api.trim()) return;
  const key = editingSource.key;
  setSavingEdit(true);
  try {
    await callSourceApi({
      action: 'update',
      key,
      name: editingSource.name,
      api: editingSource.api,
      detail: editingSource.detail || '',
      adult: editingSource.adult === true,
      disabled: editingSource.disabled === true,
    });
    setCheckStates((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setEditingSource(null);
  } catch {
    // callSourceApi 已展示错误；保留表单供用户修正。
  } finally {
    setSavingEdit(false);
  }
};
```

- [ ] **Step 9：运行组件测试并确认保存行为通过**

Run:

```bash
rtk pnpm test --runInBand src/components/admin/VideoSourceConfig.test.tsx
```

Expected: PASS。

- [ ] **Step 10：重构并回归组件测试**

补齐焦点、关闭和检测状态处理，不引入新的通用模态框依赖。

Run:

```bash
rtk pnpm test --runInBand src/components/admin/VideoSourceConfig.test.tsx
```

Expected: PASS。

- [ ] **Step 11：提交 UI 切片**

```bash
rtk git add src/components/admin/VideoSourceConfig.tsx src/components/admin/VideoSourceConfig.test.tsx
rtk git commit -m "feat(视频源): 添加自定义源编辑弹窗"
```

### Task 3：回归、审查与本地验收

**Files:**

- Verify: `src/app/api/admin/source/route.ts`
- Verify: `src/app/api/admin/source/route.test.ts`
- Verify: `src/components/admin/VideoSourceConfig.tsx`
- Verify: `src/components/admin/VideoSourceConfig.test.tsx`

- [ ] **Step 1：运行相关测试**

```bash
rtk pnpm test --runInBand src/app/api/admin/source/route.test.ts src/components/admin/VideoSourceConfig.test.tsx
```

Expected: PASS，输出无未处理错误。

- [ ] **Step 2：运行全量质量检查**

```bash
rtk pnpm test --runInBand
rtk pnpm typecheck
rtk pnpm lint
rtk pnpm build
```

Expected: 所有命令退出码为 0。

- [ ] **Step 3：按规格和代码规范执行双轴审查**

审查范围从设计文档提交 `fd9343e` 到当前 HEAD：

- 规格轴：逐项核对编辑范围、Key 只读、状态入口、错误处理和检测状态清理。
- 规范轴：检查 React 状态隔离、异步错误处理、可访问性、类型安全和测试有效性。

发现问题时先写回归测试，再修复并重跑相关检查。

- [ ] **Step 4：重建并启动 Redis 验收容器**

```bash
rtk docker build -t moontv-subscription-test .
rtk docker rm -f moontv-subscription-acceptance
rtk docker run -d \
  --name moontv-subscription-acceptance \
  --env-file .env.local \
  -p 3000:3000 \
  moontv-subscription-test
```

Expected: 容器启动，日志包含 `Redis ready`，登录页返回 HTTP 200。

- [ ] **Step 5：执行浏览器验收**

在 `http://localhost:3000/admin` 验证：

- 自定义源显示「检测、编辑、删除」。
- 内置源显示「检测、启用/禁用」。
- 模态框能修改属性和状态，Key 只读。
- 保存后列表更新且检测状态重置。
- 保存失败时输入保留。

- [ ] **Step 6：提交审查修复并确认工作树干净**

```bash
rtk git status --short
```

Expected: 无未提交文件；若审查产生修复，使用 `fix(视频源): 修复编辑功能审查问题` 提交。
