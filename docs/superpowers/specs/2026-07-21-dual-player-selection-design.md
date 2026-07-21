# 双播放器选择与 Vidstack 投屏设计

## 文档状态

- 日期：2026-07-21
- 状态：已确认，进入实施
- 影响范围：本地设置、播放页播放器宿主、ArtPlayer 与 Vidstack 实现
- 相关调研：[MoonTV 跨设备投屏与播放器选型调研](../../research/2026-07-21-cross-device-casting-player-options.md)

## 背景

MoonTV 当前使用 ArtPlayer 5.2.3 与 hls.js 1.6.6。ArtPlayer 的内建投屏控件只调用 WebKit AirPlay 接口，因此 iOS/macOS Safari 可以出现 AirPlay，Android、桌面 Chromium 和 HarmonyOS 浏览器不会因此获得 Google Cast、DLNA 或 Cast+。

项目已经依赖 `@vidstack/react@1.12.13`。Vidstack 提供 AirPlay、Google Cast、Android Remote Playback、HLS provider 和远端播放状态同步，更适合作为 MoonTV 的第二播放器。但当前播放页包含换源、选集、播放记录、去广告、片头片尾和移动端交互，直接替换播放器会造成较高回归风险。

本设计不再建设 throwaway 原型，而是直接引入正式的双播放器宿主。ArtPlayer 保持默认与完整能力，Vidstack 以实验性选项开放，并在本地播放失败时自动降级到 ArtPlayer。

## 目标

- 用户可以在本地设置中选择 ArtPlayer 或 Vidstack。
- 未设置、设置异常和旧用户继续默认使用 ArtPlayer。
- 播放页通过统一播放器 seam 挂载两个独立引擎，不复制页面业务。
- Vidstack 支持 HLS、AirPlay、Google Cast 和核心播放控制。
- Vidstack 本地播放失败时，本次播放自动降级到 ArtPlayer，并尽量保持播放状态。
- ArtPlayer 的现有功能和行为不回归。
- 不支持远程播放的浏览器不显示虚假的可用按钮。

## 非目标

- 不把播放器偏好同步到账号、Redis、D1、Upstash 或其他服务端存储。
- 不移除 ArtPlayer，也不改变默认播放器。
- 不实现 HarmonyOS 原生 Cast+、DLNA 或 Miracast。
- 不自建 Google Cast Receiver。
- 不要求 Vidstack 首期实现 ArtPlayer 的全部增强能力。
- 不把投屏设备无法访问片源的问题包装成播放器降级。

## 已确认决策

### 正式双播放器，不做 throwaway 原型

直接采用播放器宿主与两个引擎的正式结构。Vidstack 首期仍标记为实验性，但代码进入正式播放链路并接受完整的自动化与真机验收。

### 本地偏好

本地设置保存：

```text
preferredPlayer = artplayer | vidstack
```

- 缺失值、旧值和非法值一律解析为 `artplayer`。
- 修改偏好不影响当前已经挂载的播放器，下次进入播放页或刷新后生效。
- 重置本地设置时恢复 `artplayer`。
- 偏好按浏览器保存，不按登录用户区分，也不跨设备同步。

### 调试覆盖

播放页允许 URL 参数临时覆盖：

```text
player=artplayer
player=vidstack
```

优先级固定为：

```text
有效 URL 参数 > 有效本地偏好 > ArtPlayer
```

URL 覆盖不写回 localStorage。

### 自动降级

用户选择 Vidstack 后，如果 Vidstack 本地播放发生致命错误，本次页面自动切到 ArtPlayer：

- 用户偏好仍保留 Vidstack；
- 当前页面最多降级一次；
- 不允许从 ArtPlayer 反向自动切回 Vidstack；
- 降级显示一次明确提示；
- 尽量恢复当前时间、音量、倍速和播放/暂停状态。

## 架构

```text
PlayPage
  ├─ 影片详情、选集、换源、收藏、播放记录
  └─ PlayerHost
       ├─ ArtPlayerEngine
       └─ VidstackEngine
```

播放器 seam（可替换接缝）位于 `PlayerHost` 的接口。播放页不再直接依赖 ArtPlayer 或 Vidstack 的实例类型；两个引擎作为 adapter（适配器）满足同一接口。

### 建议文件结构

```text
src/components/player/
  player.types.ts
  player-preference.ts
  PlayerHost.tsx
  ArtPlayerEngine.tsx
  VidstackEngine.tsx
```

### `player.types.ts`

定义调用者必须知道的最小接口：

```ts
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
```

宿主还需要通过 ref 暴露 `play()`、`pause()`、`seek()` 和 `getSnapshot()`；通过 props 发出 `onReady`、`onTimeUpdate`、`onEnded`、`onPlay`、`onPause` 和 `onFailure`。

具体播放器的 provider、hls.js 实例、远端 session 和事件名称不得泄漏到该接口。

### `player-preference.ts`

该模块只负责：

- 校验字符串是否为合法播放器类型；
- 读取本地偏好；
- 保存本地偏好；
- 解析 URL 覆盖与本地偏好的优先级；
- 重置为 ArtPlayer。

模块不得导入 React，也不得创建播放器实例。它是设置面板和播放页共享的唯一偏好规则来源。

### `PlayerHost.tsx`

宿主负责：

- 客户端挂载后解析有效播放器；
- 偏好解析完成前显示加载状态，不短暂创建 ArtPlayer；
- 同一时间只挂载一个引擎；
- 接收引擎快照并处理 Vidstack 到 ArtPlayer 的一次性降级；
- 区分本地播放错误与远程播放错误；
- 在引擎切换期间抑制内部 pause/destroy 造成的重复播放记录；
- 向页面报告当前实际引擎和能力。

宿主不管理选集、视频源列表、收藏和账号数据。

### `ArtPlayerEngine.tsx`

第一阶段从现有播放页等价提取：

- ArtPlayer 创建、切源和销毁；
- hls.js 与自定义去广告 loader；
- HLS 错误恢复；
- ArtPlayer 设置项、片头片尾、长按快进和移动端交互；
- AirPlay；
- 播放器事件向统一接口的转换。

提取阶段不得顺带改变现有播放行为或视觉样式。

### `VidstackEngine.tsx`

首期实现：

- HLS；
- 播放、暂停、拖动、音量和倍速；
- 全屏和画中画；
- 标题、封面和初始进度；
- AirPlay；
- Google Cast；
- 本地与远端播放状态同步；
- 统一事件与错误转换。

首期明确不实现：

- 去广告 loader；
- 播放器内片头片尾设置和自动跳过；
- 长按三倍速；
- ArtPlayer 特有的横屏、锁定和移动端手势。

## 设置界面

“本地设置”增加播放器单选项：

```text
默认播放器
○ ArtPlayer（默认）
○ Vidstack（实验性）
  支持 AirPlay / Google Cast，部分播放增强功能暂不可用
```

- 选择后立即写入 localStorage。
- 当前播放页不监听设置变化，不中断播放。
- 重新打开设置时回显当前选择。
- 设置面板“重置”恢复 ArtPlayer。

## 播放数据流

### 首次挂载

1. `PlayerHost` 等待客户端挂载。
2. 读取并校验 URL `player` 参数。
3. URL 无有效值时读取 `preferredPlayer`。
4. 仍无有效值时选择 ArtPlayer。
5. 只挂载最终选定的引擎。
6. 引擎 ready 后按现有播放记录恢复进度。

### 视频地址或集数变化

1. 播放页更新统一的 `PlayerMedia`。
2. 当前引擎负责安全切源或重建内部 provider。
3. 页面仍然只保存一份当前集数和播放记录。
4. 切源产生的内部事件不得写入上一集的错误播放记录。

### Vidstack 降级

1. Vidstack 报告致命的本地播放错误。
2. 宿主读取最后一份有效 `PlayerSnapshot`。
3. 宿主标记 `fallbackUsed = true` 与 `switchReason = engine-switch`。
4. 销毁 Vidstack 和现有远程播放 session。
5. 使用相同媒体与快照挂载 ArtPlayer。
6. ArtPlayer ready 后恢复时间、音量、倍速和播放状态。
7. 页面显示“Vidstack 播放失败，已临时切换到 ArtPlayer”。
8. `preferredPlayer` 不变。

切换期间的内部 pause、destroy 和 provider change 不视为用户操作。播放记录只保存切换前的最终快照和恢复后的正常更新。

## 能力矩阵

| 能力                   | ArtPlayer | Vidstack 首期 |
| ---------------------- | --------- | ------------- |
| HLS                    | 支持      | 支持          |
| 播放、暂停、拖动       | 支持      | 支持          |
| 音量、倍速             | 支持      | 支持          |
| 全屏、画中画           | 支持      | 支持          |
| 选集、换源、自动下一集 | 页面共享  | 页面共享      |
| 播放记录               | 页面共享  | 页面共享      |
| AirPlay                | 支持      | 支持          |
| Google Cast            | 不支持    | 支持          |
| 去广告 loader          | 支持      | 首期不支持    |
| 片头片尾设置与自动跳过 | 支持      | 首期不支持    |
| 长按快进、横屏和锁定   | 支持      | 首期不支持    |

## 投屏行为

- Safari/WebKit 支持时显示 AirPlay。
- 支持的 Chrome/Edge 环境满足 Vidstack Google Cast 条件时显示 Google Cast。
- Firefox、不支持的 WebView 和没有 Remote Playback 能力的环境不显示假按钮。
- HarmonyOS 浏览器不承诺 Cast+、DLNA 或 Miracast。
- 用户取消设备选择、没有设备和接收端加载失败只显示远程播放错误，不触发本地播放器降级。
- 接收端直接访问媒体 URL；Cookie、Referer、自定义 header、去广告 loader 和浏览器代理不会自动传给电视端。

## 错误处理

### 触发 Vidstack 自动降级

- Vidstack 或 provider 初始化失败；
- 媒体格式不受支持；
- HLS 完成一次恢复后仍产生致命错误；
- 新媒体开始加载后 20 秒仍未进入可播放状态。

新媒体地址到达时重新启动 20 秒计时；ready、can-play、降级或卸载时清理计时器。

### 不触发自动降级

- 用户取消远程设备选择；
- 没有发现 Cast 设备；
- Google Cast 接收端无法访问片源；
- 远程播放会话临时断开，但本地播放器仍然可用；
- 普通 buffering 或可恢复的 HLS 网络错误。

ArtPlayer 失败时继续使用现有错误页面，不触发反向切换。

## 测试方案

### 偏好模块

- 未设置时返回 ArtPlayer。
- 两个合法值正确解析。
- 非法值回退 ArtPlayer。
- URL 参数覆盖本地值。
- 无效 URL 参数不覆盖合法本地值。
- URL 覆盖不写 localStorage。
- 重置恢复 ArtPlayer。

### 本地设置

- 选择播放器后正确保存。
- 重开面板正确回显。
- 重置恢复 ArtPlayer。
- 修改设置不切换当前播放实例。

### 播放器宿主

- 解析完成前不挂载引擎。
- 每次只挂载一个引擎。
- Vidstack 致命播放错误触发一次降级。
- 远程播放错误不触发降级。
- 降级保留快照并不修改偏好。
- 第二个播放器错误不会循环切换。
- 引擎切换不会重复保存暂停记录。

### 引擎契约

- ArtPlayer 的初始化、切源、事件、HLS 恢复和销毁行为保持不变。
- Vidstack 正确接收 HLS、标题、封面和初始时间。
- AirPlay 与 Google Cast 控件按能力显示。
- 卸载后清理 hls.js、计时器、媒体监听和远程 session。

Jest/JSDOM 不能证明真实设备投屏成功，只验证接口、状态和控件逻辑。

### 真机验收

- iPhone/iPad Safari：ArtPlayer AirPlay、Vidstack AirPlay。
- Android Chrome：Vidstack Remote Playback / Google Cast。
- 桌面 Chrome 与 Edge：Chromecast / Google TV。
- Firefox：正确隐藏不可用控件。
- HarmonyOS Browser：记录实际浏览器能力，不把 Chromium UA 当作成功。
- 公共 HLS 与至少 10 个 MoonTV 真实视频源。

每个平台验证播放、暂停、拖动、换集、断开恢复和播放记录。片源失败需要分类为 CORS、编码、防盗链、鉴权或接收端网络问题。

## 验收标准

- 新用户和旧用户默认使用 ArtPlayer。
- 本地设置可以选择 Vidstack，并在下次进入播放页或刷新后生效。
- URL 参数可以临时覆盖播放器且不污染偏好。
- ArtPlayer 现有功能和 UI 无行为回归。
- Vidstack 完成核心播放，并在支持环境显示正确的 AirPlay / Google Cast 控件。
- Vidstack 本地播放失败时一次性降级到 ArtPlayer，保持进度且不修改偏好。
- 远程播放错误不误触发本地播放器降级。
- 不支持投屏的环境不显示虚假可用按钮。
- Cloudflare Pages 构建和本地 Docker 模式通过。

## 实施顺序约束

实施计划必须按以下依赖顺序拆分：

1. 偏好模块与本地设置。
2. 播放器统一类型与宿主状态机。
3. 等价提取 ArtPlayer 引擎并完成回归。
4. 增加 Vidstack 核心播放。
5. 增加 AirPlay / Google Cast 与远程错误处理。
6. 增加一次性降级和状态恢复。
7. 自动化、Cloudflare 构建、本地 Docker 与真机验收。

在 ArtPlayer 等价提取验证完成前，不得同时重写 Vidstack 和播放页业务。
