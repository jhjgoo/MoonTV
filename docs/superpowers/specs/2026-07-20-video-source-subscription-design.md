# 视频源订阅、成人标记与联调检测设计

## 背景

MoonTV 的非 `localStorage` 部署模式支持在管理面板中动态维护视频源，但当前只能逐条添加，且视频源对象没有成人内容标记，也无法从管理面板检查采集 API 是否能正常联调。

本次改造增加 3 项能力：

1. 从 Base58 编码的远程订阅批量导入视频源。
2. 为视频源增加 `adult` 布尔属性，并在单源添加表单和列表中展示。
3. 从视频源列表按需发起真实搜索，检查采集 API 的联调状态。

## 目标

- 在「添加视频源」旁增加「添加订阅链接」入口。
- 支持形如 `https://pz.v88.qzz.io?format=2&source=full` 的 Base58 订阅。
- 服务端完成安全抓取、Base58 解码、JSON 校验、去重和一次性持久化。
- 为单源添加和订阅导入统一补全 `adult` 属性。
- 在视频源列表中显示 🔞 标记，并提供单源「检测」操作。
- 检测结果仅在当前管理页面展示，不修改视频源状态，不写入数据库。

## 非目标

- 本次不实现按用户权限过滤成人视频源。
- 本次不实现青少年模式。
- 本次不定时刷新订阅，也不保存订阅地址。
- 本次不在导入过程中自动检测全部视频源。
- 本次不持久化最后检测状态或检测时间。
- 本次不因检测失败自动禁用视频源。

后续青少年模式可以直接使用本次新增的 `adult` 属性：未开启成人内容权限的用户只能搜索 `adult === false` 的视频源。

## 已确认的产品行为

### 重复视频源

订阅条目的 Key 与现有视频源重复时跳过，不覆盖，也不自动生成新 Key。导入结果展示新增、跳过和失败数量。

### 成人内容属性

单源添加表单提供「🔞 成人内容源」复选框，默认不勾选。

订阅导入采用宽容归一化：

```ts
adult: source.adult === true
```

只有严格布尔值 `true` 会保留为 `true`。字段缺失、`false`、字符串、数字、`null`、数组或对象均归一化为 `false`，不会导致条目失败或被跳过。

### 联调检测

检测使用固定关键词「测试」发起真实搜索。以下条件同时满足时判定正常：

- 上游返回 HTTP 2xx。
- 响应体是合法 JSON。
- 响应包含数组类型的 `list` 字段。

`list` 可以为空。检测用于确认 API 协议可联调，不用于判断源中一定存在指定内容。

检测结果包含正常或异常、耗时及简短原因，只保留在当前管理页面中。

## 数据模型

### 管理配置

`AdminConfig.SourceConfig` 中的每个视频源增加必有字段：

```ts
interface AdminSource {
  key: string;
  name: string;
  api: string;
  detail?: string;
  adult: boolean;
  from: 'config' | 'custom';
  disabled?: boolean;
}
```

读取旧版 D1、Redis 或 Upstash 配置时，将缺失或非布尔的 `adult` 归一化为 `false`，因此不需要数据库迁移。

### 文件配置

文件配置与运行时视频源使用不同类型，避免把对象属性名中的 Key 与条目字段混为一谈：

```ts
interface ConfigApiSite {
  name: string;
  api: string;
  detail?: string;
  adult?: boolean;
}

interface ApiSite extends ConfigApiSite {
  key: string;
  adult: boolean;
}
```

`config.json` 的 `api_site` 保存 `Record<string, ConfigApiSite>`，视频源 Key 来自对象属性名，不在条目对象内重复保存。运行时搜索和管理配置使用带 Key 的 `ApiSite` 或 `AdminSource`。从文件配置合并到运行时配置时，同样使用 `site.adult === true` 归一化。

### 统一归一化 seam

新增 `normalizeAdminSource` 模块，以单一接口将不可信或旧版视频源数据转换成完整的 `AdminSource`。以下入口必须经过该模块：

- `config.json` 和生成的运行时文件配置。
- D1、Redis 与 Upstash 中保存的旧版 `AdminConfig.SourceConfig`。
- 单源新增接口。
- 订阅导入接口。
- 管理配置重置流程。

该模块统一完成字符串修剪、`adult` 布尔归一化和默认字段补全。订阅导入的有效条目固定写入 `from: 'custom'`、`disabled: false`；文件配置固定写入 `from: 'config'`。

## API 设计

### 保留现有视频源管理接口

`POST /api/admin/source` 继续负责以下操作：

- `add`
- `enable`
- `disable`
- `delete`
- `sort`

`add` 操作增加 `adult?: boolean`。服务端使用 `adult === true` 写入，缺失或非布尔值均为 `false`。

### 新增订阅导入接口

`POST /api/admin/source/subscription`

请求体：

```json
{
  "url": "https://pz.v88.qzz.io?format=2&source=full"
}
```

接口独立完成以下步骤：

1. 拒绝 `localStorage` 模式。
2. 检查登录信息和管理员权限。
3. 校验订阅 URL 的安全性。
4. 抓取受限制大小的 Base58 文本。
5. 解码为 UTF-8 JSON。
6. 校验顶层 `api_site` 对象。
7. 逐条清洗并归一化视频源。
8. 跳过已有 Key，收集无效条目。
9. 将有效条目一次性合并到 `AdminConfig.SourceConfig`。
10. 调用一次 `setAdminConfig` 持久化。

订阅导入采用以下资源上限：

- Base58 响应体最大 1 MiB。
- 单个订阅最多 500 个条目。
- 合并后的 `SourceConfig` 最多 1,000 个视频源。
- Key 与名称修剪后最长 128 个字符。
- API 与 Detail URL 最长 2,048 个字符。

超出任一批次级上限时整次导入失败，不修改存储。响应体必须通过流式读取累计字节；不能先完整调用 `response.text()` 再判断大小。

成功响应：

```json
{
  "ok": true,
  "added": 68,
  "skipped": 4,
  "failed": 0,
  "skippedItems": [
    {
      "key": "existing-source",
      "reason": "duplicate"
    }
  ],
  "failedItems": []
}
```

失败和跳过明细最多各返回 20 条，防止响应体失控。

### 新增联调检测接口

`POST /api/admin/source/check`

请求体：

```json
{
  "key": "iqiyi_custom"
}
```

接口独立完成以下步骤：

1. 拒绝 `localStorage` 模式。
2. 检查登录信息和管理员权限。
3. 从服务端配置中按 Key 查找视频源。
4. 拼接固定关键词「测试」的搜索地址。
5. 在超时限制内发起请求并解析 JSON。
6. 校验响应中是否存在数组类型的 `list`。

联调正常响应：

```json
{
  "healthy": true,
  "latencyMs": 286,
  "message": "接口响应正常"
}
```

上游异常响应：

```json
{
  "healthy": false,
  "latencyMs": 8000,
  "message": "请求超时"
}
```

上游超时、非 2xx、非法 JSON 或缺少 `list` 属于检测结果，接口返回结构化的 `healthy: false`。参数错误、权限不足和源不存在属于接口错误，返回对应的 4xx 状态码。

### 权限检查

订阅和检测使用独立路由。每个路由分别执行存储模式检查、Cookie 登录检查、站长或管理员权限判断，不抽取公共路由鉴权层。

## 模块边界

### 订阅处理模块

负责：

- Base58 解码。
- UTF-8 和 JSON 解析。
- `api_site` 结构校验。
- 视频源字段清洗和 `adult` 归一化。
- 重复 Key 计算和导入结果汇总。

该模块不读取 Cookie、不访问数据库、不渲染 UI。

### 安全抓取模块

负责：

- URL 协议和主机校验。
- 订阅请求超时。
- 响应体大小限制。
- 重定向次数限制和每跳重新校验。
- 拒绝 localhost、私网、链路本地和保留 IP 字面量。

订阅 URL、订阅条目中的 API URL，以及非空 Detail URL 均必须通过同一套公网 URL 校验：只接受 HTTPS，不允许内嵌用户名或密码，并拒绝显式的 localhost、私网、链路本地和保留 IP 字面量。不安全的 API 或 Detail 会让对应条目失败，不能静默丢弃 Detail 后继续导入。

抓取限制为 3 次重定向和 10 秒超时。每次重定向使用 `redirect: 'manual'`，重新校验 `Location` 后才能继续。响应体通过 `ReadableStream` 累计读取，超过 1 MiB 时立即取消 Reader 并中止请求。

Cloudflare Edge 无法使用 Node.js `dns.lookup` 对任意主机名执行可靠的私网解析检查，因此本次威胁模型保证拦截显式危险主机、IP 字面量和危险重定向，不宣称可以彻底防御 DNS rebinding。验收测试覆盖可确定验证的 URL 形式和重定向链。

### 联调检测模块

负责：

- 拼接搜索 URL。
- 记录请求耗时。
- 将 HTTP、超时和 JSON 错误转换为稳定的检测结果。
- 校验 `list` 是否为数组。

该模块返回结果，不修改视频源对象。

## 管理页面设计

### 可测试模块 seam

将当前内嵌在 `src/app/admin/page.tsx` 的 `VideoSourceConfig` 提取为独立模块。管理页只负责传入 `config` 与 `refreshConfig`，模块内部管理单源表单、订阅表单、检测状态和拖拽排序。

独立模块复用 `AdminSource` 类型，不再维护一份局部 `DataSource` 结构。调用方和测试都通过同一个 Props 接口使用该模块，避免为了测试导入整个管理页面。

### 添加入口

「视频源列表」标题右侧显示两个并列按钮：

- 「添加视频源」
- 「添加订阅链接」

两个表单互斥展开。打开一个表单时自动关闭另一个。

### 单源添加表单

保留名称、Key、API 地址和可选 Detail 地址，在字段下方增加「🔞 成人内容源」复选框。表单提交和重置时均保证默认值为 `false`。

### 订阅添加表单

表单包含：

- 订阅 URL 输入框。
- 「解析并导入」按钮。
- 提交中的禁用和加载状态。
- 导入后的新增、跳过和失败汇总。
- 有限的失败或跳过明细。

### 视频源列表

列表增加：

- 🔞 列：`adult === true` 时显示醒目标记，否则显示 `—`。
- 「检测」操作。
- 临时检测状态：未检测、检测中、正常、异常。

正常状态显示耗时；异常状态显示简短原因；检测中禁用重复点击；异常后按钮文案改为「重新检测」。页面刷新后所有检测状态清空。

## 错误处理与一致性

以下全局错误会终止整次导入，且不修改 D1：

- 订阅 URL 不合法。
- 抓取失败、超时或响应过大。
- Base58 解码失败。
- 解码内容不是 UTF-8。
- JSON 解析失败。
- 顶层缺少合法的 `api_site` 对象。

顶层订阅有效后逐项处理：

- Key、名称或 API 缺失：计入失败并跳过。
- API 或非空 Detail URL 不合法、不安全或超过长度限制：计入失败并跳过。
- Key 已存在：计入跳过，不覆盖。
- `adult` 非布尔：归一化为 `false`，继续导入。
- 额外字段：丢弃，不进入管理配置。

所有有效条目完成清洗后，再执行一次持久化。若持久化失败，接口返回失败，不返回导入成功。

错误响应不包含远端响应原文、内部堆栈或敏感配置。

## 测试设计

### Base58 与订阅解析单元测试

- 有效 Base58 JSON。
- 非法 Base58 字符。
- 空内容。
- 非 UTF-8 内容。
- 畸形 JSON。
- 缺少 `api_site`。
- 合法的多源订阅。
- 缺失核心字段的条目。
- 重复 Key。
- `adult: true` 和 `adult: false`。
- `adult` 缺失。
- `adult` 为 `"true"`、`1`、`null`、数组和对象时均为 `false`。
- 额外字段被丢弃。
- 有效订阅源固定归一化为 `from: 'custom'`、`disabled: false`。
- 超过条目数、总源数或字段长度上限。

### 安全抓取单元测试

- 仅接受 HTTPS。
- 拒绝内嵌凭据。
- 拒绝 localhost、私网、链路本地和保留 IP。
- 每次重定向重新校验目标。
- 重定向次数上限。
- 请求超时。
- 响应体大小上限。
- 通过流式读取在超过上限时立即取消。
- 订阅条目中的 API 与 Detail 复用相同校验。
- Cloudflare Edge 威胁模型仅承诺阻止可确定识别的危险目标。

### 订阅路由测试

- `localStorage` 模式拒绝调用。
- 未登录拒绝调用。
- 普通用户无权限。
- 站长和管理员允许调用。
- 全局解析失败时不持久化。
- 重复和无效条目分别汇总。
- 一批有效条目只调用一次持久化。
- 响应明细受数量上限约束。

### 检测模块与路由测试

- HTTP 2xx 且 `list` 为非空数组。
- HTTP 2xx 且 `list` 为空数组。
- 非 2xx。
- 请求超时。
- 非法 JSON。
- 缺少 `list`。
- `list` 不是数组。
- 源不存在。
- 权限检查。

### 管理页面测试

- 两个添加表单互斥。
- 单源 `adult` 默认不勾选。
- 单源提交正确传递 `adult`。
- 订阅提交显示加载状态和导入汇总。
- 🔞 列正确显示。
- 检测状态在未检测、检测中、正常、异常之间转换。
- 检测结果不写入源对象，刷新配置时清空。
- `VideoSourceConfig` 可以通过独立 Props 接口渲染和测试。

## 验收标准

1. 管理员可以粘贴示例 Base58 订阅链接并完成批量导入。
2. 已存在的 Key 不被覆盖，页面准确显示新增、跳过和失败数量。
3. 单源和订阅源都具备稳定的 `adult` 布尔值。
4. 非布尔 `adult` 不会导致导入失败，并统一为 `false`。
5. 视频源列表显示 🔞 标记和按需检测按钮。
6. 检测能区分协议正常、HTTP 异常、超时和响应格式错误。
7. 检测状态不写入 D1，不会自动禁用视频源。
8. 非管理员无法导入订阅或检测视频源。
9. 订阅 URL、导入的 API 与 Detail 拒绝显式本地、私网、链路本地、保留 IP 及危险重定向；不对 DNS rebinding 作无法证明的绝对承诺。
10. 新增自动化测试通过，现有构建、类型检查和代码规范检查不回归。
