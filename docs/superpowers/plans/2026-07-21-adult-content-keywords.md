# 用户成人内容关键词过滤 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将内容关键词过滤纳入用户 `adult` 权限，并提供管理员可维护的成人内容词库。

**Architecture:** 用纯内容判定模块统一标题、分类和简介的关键词匹配；路由基于即时用户权限决定是否调用该判定。词库保存在 `SiteConfig.AdultKeywords`，配置兼容层负责将旧黄色词库和新增默认词一次迁入，管理员专用 API 管理数组。

**Tech Stack:** Next.js App Router、TypeScript、React、Redis/D1/Upstash 配置存储、Jest。

---

### Task 1: 词库模型、迁移与内容判定

**Files:**
- Create: `src/lib/adult-keywords.ts`
- Create: `src/lib/adult-keywords.test.ts`
- Modify: `src/lib/admin.types.ts`
- Modify: `src/lib/config.ts`
- Delete: `src/lib/yellow.ts`

- [ ] **Step 1: 写失败测试，覆盖默认词库、历史配置迁移、大小写去重与标题/分类/简介匹配。**

```ts
expect(normalizeAdultKeywords([' 金瓶梅 ', '金瓶梅', 'AV女优'])).toEqual([
  '金瓶梅',
  'AV女优',
]);
expect(matchesAdultKeyword({ title: '金瓶梅', type_name: '', desc: '' }, ['金瓶梅'])).toBe(true);
expect(matchesAdultKeyword({ title: '普通电影', type_name: '剧情', desc: '' }, ['金瓶梅'])).toBe(false);
```

- [ ] **Step 2: 运行 `npm test -- --runInBand src/lib/adult-keywords.test.ts`，确认模块不存在而失败。**
- [ ] **Step 3: 实现 `DEFAULT_ADULT_KEYWORDS`、`normalizeAdultKeywords` 与 `matchesAdultKeyword`；在 `AdminConfig.SiteConfig` 添加 `AdultKeywords`，并在所有 `getConfig` 初始化/读取分支为缺失或无效词库迁入默认值后持久化。**
- [ ] **Step 4: 移除 `DisableYellowFilter` 类型、环境变量映射和 `yellow.ts`，确保旧字段不再被读取。**
- [ ] **Step 5: 重跑词库测试并提交 `feat: 增加成人内容关键词词库`。**

### Task 2: 管理员关键词 API

**Files:**
- Create: `src/app/api/admin/adult-keyword/route.ts`
- Create: `src/app/api/admin/adult-keyword/route.test.ts`

- [ ] **Step 1: 写失败测试，覆盖 owner/admin 的 add、update、delete，普通用户 `401`，空白/重复词 `400`，不存在词 `404`。**

```ts
expect(addResponse.status).toBe(200);
expect(config.SiteConfig.AdultKeywords).toContain('金瓶梅');
expect(duplicateResponse.status).toBe(400);
expect(userResponse.status).toBe(401);
```

- [ ] **Step 2: 运行 `npm test -- --runInBand src/app/api/admin/adult-keyword/route.test.ts`，确认路由不存在而失败。**
- [ ] **Step 3: 实现 `{ action: 'add' | 'update' | 'delete', keyword, nextKeyword? }` 路由；复用管理员鉴权、词库归一化和 `setAdminConfig`，并对 update/delete 使用归一化后的精确词条匹配。**
- [ ] **Step 4: 重跑路由测试并提交 `feat: 支持管理成人内容关键词`。**

### Task 3: 服务端搜索与详情内容权限

**Files:**
- Modify: `src/app/api/search/route.ts`
- Modify: `src/app/api/search/one/route.ts`
- Modify: `src/app/api/detail/route.ts`
- Modify: `src/app/api/search/route.test.ts`
- Create: `src/app/api/search/one/route.test.ts`
- Create: `src/app/api/detail/route.test.ts`

- [ ] **Step 1: 写失败测试：未开启用户的聚合搜索会移除标题、分类或简介命中项；开启用户保留；单源搜索与详情命中时返回 `403 未开启成人内容访问权限`。**

```ts
expect((await response.json()).results).toEqual([]);
expect(detailResponse.status).toBe(403);
expect(adultAccessResponse.status).toBe(200);
```

- [ ] **Step 2: 分别运行三个路由测试，确认缺少内容级判定而失败。**
- [ ] **Step 3: 在源级判定后，对未开启用户执行 `matchesAdultKeyword`；聚合搜索过滤数组，单源搜索与详情用稳定 `403` 拒绝。所有成功响应继续 `Cache-Control: no-store`。**
- [ ] **Step 4: 删除旧的 `yellowWords` 过滤分支与依赖。**
- [ ] **Step 5: 重跑三个测试并提交 `feat: 按用户权限过滤成人内容关键词`。**

### Task 4: 收藏和播放记录防绕过

**Files:**
- Modify: `src/app/api/favorites/route.ts`
- Modify: `src/app/api/playrecords/route.ts`
- Create: `src/app/api/favorites/route.test.ts`
- Create: `src/app/api/playrecords/route.test.ts`

- [ ] **Step 1: 写失败测试：未开启用户的全量读取隐藏标题或搜索标题命中项，单条读取与 POST 命中返回 `403`；DELETE 仍成功；开启用户可读取和新增。**
- [ ] **Step 2: 运行两套测试，确认当前仅按源标记过滤而失败。**
- [ ] **Step 3: 读取路径在源级判断外叠加内容关键词判断；POST 用 `favorite.title`/`favorite.search_title` 或 `record.title`/`record.search_title` 判定并拒绝。**
- [ ] **Step 4: 重跑测试并提交 `feat: 防止关键词内容绕过收藏与记录`。**

### Task 5: 管理员设置界面与旧开关移除

**Files:**
- Modify: `src/app/admin/page.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/search/page.tsx`
- Modify: `src/app/api/admin/site/route.ts`
- Modify: `README.md`
- Test: `src/components/admin/VideoSourceConfig.test.tsx` 或新增 `src/app/admin/page.test.tsx`

- [ ] **Step 1: 写失败 UI/API 测试，断言“成人内容关键词”区可添加、编辑、删除词条，且不再显示“禁用黄色过滤器”开关。**
- [ ] **Step 2: 运行测试并确认当前界面/类型不满足。**
- [ ] **Step 3: 在管理员设置增加独立折叠配置区（输入框、添加按钮、词表、编辑/删除操作）；调用新路由后刷新配置。移除 SiteConfig 中旧开关的表单、序列化、运行时配置和客户端二次过滤。**
- [ ] **Step 4: 删除 README 的 `NEXT_PUBLIC_DISABLE_YELLOW_FILTER` 文档；重跑 UI/API 测试并提交 `feat: 提供成人内容关键词设置`。**

### Task 6: 全量验证与验收

**Files:**
- Modify: `docs/superpowers/plans/2026-07-21-adult-content-keywords.md`（勾选完成项）

- [ ] **Step 1: 运行 `npm test -- --runInBand`、`npm run lint`、`npm run build`。**
- [ ] **Step 2: 在 Redis 验收环境中，用未开启权限用户验证“金瓶梅”搜索为空、详情为 `403`；开启权限后两者成功。**
- [ ] **Step 3: 验证管理员新增词后下一次请求立即生效；删除词后结果恢复。**
- [ ] **Step 4: 提交最终验证调整（如有），并准备本地验收镜像。**
