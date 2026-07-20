# 用户级成人内容访问控制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让管理员能为用户开关成人内容权限，并在所有视频源访问入口服务端执行该权限。

**Architecture:** 用配置读取型权限 helper 将认证用户的即时 `adult` 权限与视频源访问判断集中起来。管理接口只修改该配置字段；搜索、单源搜索、详情、收藏和播放记录路由复用 helper，既阻止上游调用也阻止旧链接和既有数据绕过。

**Tech Stack:** Next.js App Router（edge routes）、TypeScript、Vitest、React。

---

### Task 1: 用户权限模型与访问控制 helper

**Files:**

- Modify: `src/lib/admin.types.ts`
- Create: `src/lib/source-access.ts`
- Create: `src/lib/source-access.test.ts`

- [ ] **Step 1: 写入失败测试，覆盖旧值归一化、源过滤与拒绝错误。**

```ts
expect(normalizeAdultAccess(true)).toBe(true);
expect(normalizeAdultAccess('true')).toBe(false);
expect(filterAccessibleSources(sources, false).map((s) => s.key)).toEqual([
  'safe',
]);
expect(() => assertSourceAccessible(adultSource, false)).toThrow(
  '未开启成人内容访问权限'
);
```

- [ ] **Step 2: 运行 `npm test -- src/lib/source-access.test.ts`，确认因模块不存在而失败。**
- [ ] **Step 3: 在 `UserConfig.Users` 中加入 `adult?: boolean`，实现 `normalizeAdultAccess`、`getCurrentAdultAccess(request)`、`filterAccessibleSources` 和 `assertSourceAccessible`。**
- [ ] **Step 4: 重跑同一测试，确认通过。**
- [ ] **Step 5: 提交 `feat: 增加成人内容访问控制`。**

### Task 2: 管理操作与配置兼容

**Files:**

- Modify: `src/lib/config.ts`
- Modify: `src/app/api/admin/user/route.ts`
- Create: `src/app/api/admin/user/route.test.ts`

- [ ] **Step 1: 写入失败测试，分别验证 `setAdultAccess` 的布尔校验、站长对自身操作、管理员仅操作普通用户和新建用户默认关闭。**

```ts
expect(response.status).toBe(400); // adult: 'true'
expect(ownerSelfResponse.status).toBe(200);
expect(adminToOwnerResponse.status).toBe(403);
expect(saved.Users.find((u) => u.username === 'new-user')?.adult).toBe(false);
```

- [ ] **Step 2: 运行 `npm test -- src/app/api/admin/user/route.test.ts`，确认当前 action 不支持而失败。**
- [ ] **Step 3: 新增 `setAdultAccess` action 与 `adult: boolean` 请求字段；只为该 action 放开站长自身及 owner 目标限制，并以 `403` 拒绝管理员操作 admin/owner。所有配置初始化、补全、重置和 owner 注入路径都将缺失或非布尔值归一化为 `false`。**
- [ ] **Step 4: 重跑管理路由测试，确认通过。**
- [ ] **Step 5: 提交 `feat: 支持管理用户成人权限`。**

### Task 3: 管理面板展示与开关

**Files:**

- Modify: `src/app/admin/page.tsx`
- Modify: `src/components/admin/VideoSourceConfig.test.tsx`（若现有测试 setup 可复用；否则新增 `src/app/admin/page.test.tsx`）

- [ ] **Step 1: 写入失败 UI 测试，断言用户列表展示 `🔞` 状态，站长可看见自己的切换按钮，管理员对普通用户可切换而不能对管理员切换。**
- [ ] **Step 2: 运行对应测试并确认失败。**
- [ ] **Step 3: 增加 `adult` 状态列、`handleSetAdultAccess(username, adult)`，并单独计算 `canManageAdult`：owner 为所有用户（含自己），admin 仅普通用户。按钮文本依据当前值为 `开启🔞` 或 `关闭🔞`，成功后刷新配置。**
- [ ] **Step 4: 重跑 UI 测试并确认通过。**
- [ ] **Step 5: 提交 `feat: 在用户管理中开关成人权限`。**

### Task 4: 搜索与详情服务端边界

**Files:**

- Modify: `src/app/api/search/route.ts`
- Modify: `src/app/api/search/one/route.ts`
- Modify: `src/app/api/detail/route.ts`
- Create: `src/app/api/search/route.test.ts`
- Create: `src/app/api/search/one/route.test.ts`
- Create: `src/app/api/detail/route.test.ts`

- [ ] **Step 1: 写失败路由测试：未开启用户的聚合搜索不调用成人源；单源搜索与详情访问成人源得到 `403` 和“未开启成人内容访问权限”；开启用户仍可访问。**
- [ ] **Step 2: 分别运行三个路由测试，确认失败原因是缺少权限筛选。**
- [ ] **Step 3: 聚合搜索在构建 `searchFromApi` promises 前调用过滤 helper；单源搜索和详情先按完整启用源定位，再调用断言 helper，避免将权限错误伪装为不存在。**
- [ ] **Step 4: 重跑三个路由测试并确认通过。**
- [ ] **Step 5: 提交 `feat: 限制成人视频源搜索与详情访问`。**

### Task 5: 收藏与播放记录防绕过

**Files:**

- Modify: `src/app/api/favorites/route.ts`
- Modify: `src/app/api/playrecords/route.ts`
- Create: `src/app/api/favorites/route.test.ts`
- Create: `src/app/api/playrecords/route.test.ts`

- [ ] **Step 1: 写失败测试：未开启用户读取全部收藏/记录时成人源条目被隐藏；读取单条或写入成人源返回 `403`；开启用户仍得到原数据。**
- [ ] **Step 2: 运行两套测试并确认失败。**
- [ ] **Step 3: 复用 helper 解析 key 的 source，并在 GET 全量返回前过滤、单条 GET 与 POST 前断言访问权限；删除操作保持可用，以便用户清理历史数据。**
- [ ] **Step 4: 重跑测试并确认通过。**
- [ ] **Step 5: 提交 `feat: 隐藏无权限用户的成人历史数据`。**

### Task 6: 全量验证

**Files:**

- Modify: `docs/superpowers/plans/2026-07-21-user-adult-access.md`（勾选完成项）

- [ ] **Step 1: 运行 `npm test`，修复本功能导致的失败。**
- [ ] **Step 2: 运行 `npm run lint` 与 `npm run build`，确认通过。**
- [ ] **Step 3: 用有效 session 手工验证：管理员切换后，目标用户下一次请求立即获得或失去成人源访问权限。**
- [ ] **Step 4: 提交 `test: 覆盖成人内容访问权限`（若验证调整产生未提交文件）。**
