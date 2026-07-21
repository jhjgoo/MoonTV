# MoonTV 跨设备投屏与播放器选型调研

> 调研日期：2026-07-21  
> 范围：Web、iOS/iPadOS、Android、HarmonyOS；AirPlay、Google Cast、Remote Playback、DLNA/Miracast；只采用浏览器标准、厂商文档和项目官方源码。

## 结论先行

**如果目标是让播放器自身在支持的平台上显示 AirPlay / Google Cast 按钮，并且投屏后仍能暂停、跳转、同步进度，Vidstack 是 MoonTV 当前最合适的替换候选。** 它在 React 中提供一等的 `AirPlayButton`、`GoogleCastButton`、Google Cast provider，并分别适配 WebKit AirPlay、桌面 Chromium Cast Sender SDK 和 Android Chrome 的原生 Remote Playback。MoonTV 已经依赖 `@vidstack/react@1.12.13`，该版本安装包中也包含这些接口，减少了新增依赖的不确定性。

但换播放器不能带来“所有设备都能投屏”：

- AirPlay 由 Apple/WebKit 与接收设备决定；Firefox 不会因为换播放器而获得 AirPlay。
- Google Cast 依赖 Chromium、Google Cast sender/receiver 生态；不能等同于通用 DLNA。
- HarmonyOS/OpenHarmony 的 Cast+、Miracast、DLNA 属于系统原生 Cast Engine 能力，并没有一个被主流 Web 播放器普遍调用的浏览器标准入口。因此 HarmonyOS 浏览器若没有实现 Remote Playback 或自己的网页桥接，换成任何候选播放器都不会自动出现华为投屏设备。
- 投屏设备会直接请求视频 URL。MoonTV 本地 hls.js 能播，不代表接收端一定能播；CORS、防盗链、Cookie/Referer、地区网络、HTTP/HTTPS、临时签名和源站可达性仍会决定成功率。

推荐路线是：**不要直接重写 1,982 行播放页；先把播放器抽成适配层，用功能开关做 Vidstack 并行原型，在真实 iOS + Android Chrome + 桌面 Chrome/Edge + Chromecast/Google TV 上验证。** 若未来明确需要 Widevine/FairPlay、DASH 或自建 Cast Receiver，再把 Shaka Player 作为 DRM/专业流媒体路线评估。

## MoonTV 当前事实

1. 当前播放器是 Artplayer `5.2.3` + hls.js `1.6.6`。播放页启用了 `airplay: true`，并把 `video.disableRemotePlayback` 设为 `false`，还额外插入 `<source>` 供远程播放发现；这解释了 iOS 上为什么能看到 AirPlay。[当前依赖](../../package.json)；[播放页 AirPlay 配置](../../src/app/play/page.tsx#L1220-L1260)；[Remote Playback 属性处理](../../src/app/play/page.tsx#L420-L438)
2. Artplayer **核心的 AirPlay 实现只检查 WebKit API**：`WebKitPlaybackTargetAvailabilityEvent` 和 `webkitShowPlaybackTargetPicker()`。因此 `airplay: true` 本身不会在 Android/桌面 Chromium 中创建 Google Cast 控件。[Artplayer 官方源码](https://github.com/zhw2590582/ArtPlayer/blob/02d1ded7b8601b8cc654e33d066d996968c7bdc0/packages/artplayer/src/player/airplayMix.js)
3. Artplayer 官方仓库另有 `artplayer-plugin-chromecast` 1.1.0，能加载 Cast Sender SDK、选择设备并把当前 URL 发给默认接收器；但当前 MoonTV 没有安装或注册该插件。[插件官方源码](https://github.com/zhw2590582/ArtPlayer/blob/02d1ded7b8601b8cc654e33d066d996968c7bdc0/packages/artplayer-plugin-chromecast/src/index.js)；[插件说明](https://github.com/zhw2590582/ArtPlayer/blob/02d1ded7b8601b8cc654e33d066d996968c7bdc0/packages/artplayer-plugin-chromecast/README.md)
4. 该 Artplayer 插件目前只在发起时调用 `loadMedia()`；源码没有使用 `RemotePlayer` 去代理播放、暂停、跳转、音量和进度，也没有 Android Remote Playback 适配。因此它适合低成本 PoC，不宜在未做真机验证前当作完整跨端方案。[插件官方源码](https://github.com/zhw2590582/ArtPlayer/blob/02d1ded7b8601b8cc654e33d066d996968c7bdc0/packages/artplayer-plugin-chromecast/src/index.js)
5. MoonTV 曾在提交 [`537e070`](https://github.com/MoonTechLab/LunaTV/commit/537e07057ae16edd5011ecb042f985b17137174e) 中把播放页迁到 Vidstack，后来又在提交 [`e70289f`](https://github.com/MoonTechLab/LunaTV/commit/e70289f27d5b5a55a72b98f1d20b7bd122b21126) 的新播放页路线中迁回 Artplayer。提交信息没有记录回迁原因，不能把它解读为“Vidstack 投屏不可用”；但旧代码可作为迁移时的参考和回归清单。
6. `@vidstack/react@1.12.13` 与旧 `vidstack@0.6.15` 仍在依赖中，但当前 `src` 没有引用。安装的 1.12.13 类型和默认布局已包含 `GoogleCastButton`、`GoogleCastProvider`、`requestGoogleCast()`、AirPlay、字幕、画中画、倍速和 HLS provider。[当前依赖](../../package.json)

## “投屏”不是播放器单独提供的能力

浏览器播放器最多负责三件事：显示按钮、调用浏览器/厂商 SDK、在本地与远端播放器之间同步状态。设备发现、协议、接收端解码和源站访问不由播放器决定。

### Remote Playback API

W3C 标准给 `<video>` 暴露 `video.remote`，包括 `watchAvailability()`、`prompt()` 和连接状态；`prompt()` 必须由用户手势触发。设备类型和可用媒体源的判断由浏览器实现，并没有“枚举 DLNA/投屏设备并指定协议”的通用网页 API。[W3C Remote Playback 规范](https://w3c.github.io/remote-playback/)

MDN Browser Compat Data 当前记录：Chrome 桌面从 121、Chrome Android 从 56、Edge 跟随 Chromium、Safari/iOS Safari 从 13.1 支持；Firefox 和 Android WebView 不支持。HarmonyOS Browser 没有独立条目，因此不能根据 Chromium 内核版本直接承诺可用。[MDN 官方兼容数据](https://github.com/mdn/browser-compat-data/blob/e6bb3613298ff031ed72350420aaf9b75e46195e/api/RemotePlayback.json)

这也说明 MoonTV 现在仅设置 `disableRemotePlayback = false` 不够：它只是“没有禁止远程播放”，并不会自动在 Artplayer 控制栏生成跨浏览器按钮。

### AirPlay

Artplayer、Plyr、Media Chrome、Vidstack 等最终都调用 WebKit/媒体元素提供的能力。接收端、同网发现和兼容性由 Safari/WebKit 决定。换皮肤或播放器不会让 Firefox/不支持的 WebView 实现 AirPlay。Artplayer 的实现尤其明确，只调用 `webkitShowPlaybackTargetPicker()`。[Artplayer 官方源码](https://github.com/zhw2590582/ArtPlayer/blob/02d1ded7b8601b8cc654e33d066d996968c7bdc0/packages/artplayer/src/player/airplayMix.js)

### Google Cast / Chromecast

Web 发送端需要加载 Google Cast Sender SDK，建立 Cast session，然后把媒体 URL、类型、标题、封面、字幕轨等交给接收端。Google 官方将 Chrome Web sender、Android native sender、iOS native sender 作为不同参考应用；网页播放器并不能替代 Android/iOS 原生 Cast SDK。[Google 官方 Chrome Sender 示例](https://github.com/googlecast/CastVideos-chrome)；[Google Cast Web Sender 文档](https://developers.google.com/cast/docs/web_sender)

普通 MP4/HLS 可先使用 Default Media Receiver；需要自定义鉴权、DRM、网络请求改写、UI 或业务消息时要注册/托管自定义 Web Receiver。Shaka 的设计文档也明确指出：发送端的网络过滤器、函数和鉴权逻辑不能序列化到接收端，必须由接收端重新实现或通过 app data 传递必要数据。[Google Cast Receiver 概览](https://developers.google.com/cast/docs/web_receiver)；[Shaka Cast 设计](https://github.com/shaka-project/shaka-player/blob/0ee962d613ce1331fe5e4d23433b596ee3adce85/docs/design/current/chromecast.md)

### HarmonyOS、Cast+、DLNA、Miracast

OpenHarmony 的 Cast Engine SIG 将 Cast+ Stream、Miracast、DLNA 描述为系统投屏能力，并提供统一的**原生**框架接口。[OpenHarmony Cast Engine SIG](https://github.com/openharmony/community/blob/f29ce2efb7e4eda32fd8035ef0c48907892ee619/sig/sig_castengine/sig_castengine.md)

本次检查的播放器都没有官方声明能从普通网页直接调用该 Cast Engine。可实现的产品策略是：

- 浏览器实现 Remote Playback 时显示标准投屏按钮；
- 不支持时不显示假按钮，提示使用浏览器/系统的“无线投屏/镜像”；
- 如果未来有 HarmonyOS 原生壳，再通过 JS Bridge 对接 Cast Engine；
- 若必须从纯 Web 主动发现 DLNA 设备，需要服务端/局域网代理或原生辅助程序，Cloudflare Pages 纯前端无法直接完成 SSDP/UPnP 局域网发现。

## 候选播放器比较

| 候选                             | AirPlay               | Google Cast / Android Remote Playback                                                       | HLS                       | 字幕/倍速/PiP | DRM                                            | 对 MoonTV 的判断                                                                                                                                                                                                                                                                                     |
| -------------------------------- | --------------------- | ------------------------------------------------------------------------------------------- | ------------------------- | ------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vidstack**                     | 一等按钮和状态        | 一等 Google Cast provider；桌面加载 Sender SDK；Android Chrome 使用媒体元素 Remote Playback | 内建 hls.js provider      | 完整          | 可下钻配置底层 provider，但不是其最强卖点      | **首选**。React 适配最好，依赖已存在；远端状态、播放/暂停/跳转和 VTT 字幕同步比 Artplayer 插件完整                                                                                                                                                                                                   |
| **Shaka Player**                 | UI/Remote Playback    | 内建 CastProxy、sender 与 receiver 支持，需要 receiver app id                               | 原生 HLS/DASH 引擎        | 完整          | **最强**：MSE/EME、Widevine/PlayReady/FairPlay | 次选。适合未来 DRM/DASH/自定义 Receiver；对当前普通聚合 HLS 偏重，迁移成本最高                                                                                                                                                                                                                       |
| Artplayer + 官方 Chromecast 插件 | 核心仅 WebKit         | 插件可发起 Cast，但远端控制/状态能力较浅；无完整 Android Remote Playback UI                 | MoonTV 已用 hls.js        | 完整          | 依赖底层自配                                   | 最小改动 PoC，可快速判断片源是否能被 Chromecast 直连；不作为最终跨端架构首选                                                                                                                                                                                                                         |
| Video.js                         | 依赖浏览器/插件       | 核心没有官方 Cast sender；常见 Chromecast 插件来自第三方仓库                                | VHS 成熟                  | 完整          | 可用官方生态插件扩展                           | 成熟但插件组合更重，没有比 Vidstack 更直接地解决本需求。[Video.js 核心源码搜索](https://github.com/videojs/video.js/tree/1ce2b219f450842455e120518bf669e1d5b2ae38)                                                                                                                                   |
| Plyr                             | 内建 AirPlay 控件     | 无内建 Google Cast provider                                                                 | 需接 hls.js/Shaka/dash.js | 完整          | 依赖底层播放器                                 | UI 简洁，但投屏覆盖不如 Vidstack。[Plyr 官方 README](https://github.com/sampotts/plyr/blob/6520022413161d06e61d396810f48cac551fa7b5/README.md)                                                                                                                                                       |
| DPlayer                          | 未提供一等跨端投屏    | 无官方 Cast provider                                                                        | 需 hls.js                 | 基础功能完整  | 依赖底层                                       | 中文场景熟悉，但不能解决核心问题。[DPlayer 官方仓库](https://github.com/DIYgod/DPlayer/tree/bc43cc0ac2470f3b3552414a81e64b913b107bb3)                                                                                                                                                                |
| Media Chrome                     | AirPlay Web Component | Cast 按钮要求实现 `CastableMedia` 的媒体元素；官方示例依赖已归档的 `castable-video`         | **只做 UI，不是播放引擎** | 控件完整      | 取决于底层                                     | 不应视为直接替换播放器；更适合已有媒体引擎的自定义控制层。[官方 Cast Button 文档](https://github.com/muxinc/media-chrome/blob/c62476041348882699b6925c429dc89774394887/docs/src/pages/docs/en/components/media-cast-button.mdx)；[`castable-video` 已归档](https://github.com/muxinc/castable-video) |

Vidstack 的关键区别不是多一个图标，而是远端 provider 真正代理了 `RemotePlayer`：处理播放/暂停、seek、音量、连接恢复、断开后的本地状态恢复、标题/封面和 VTT 字幕轨。[Vidstack Google Cast loader](https://github.com/vidstack/player/blob/04143af0634c5c9633dbd05423d0ee62f99754fd/packages/vidstack/src/providers/google-cast/loader.ts)；[Google Cast provider](https://github.com/vidstack/player/blob/04143af0634c5c9633dbd05423d0ee62f99754fd/packages/vidstack/src/providers/google-cast/provider.ts)；[Android Remote Playback 适配](https://github.com/vidstack/player/blob/04143af0634c5c9633dbd05423d0ee62f99754fd/packages/vidstack/src/providers/html/remote-playback.ts)

Shaka 的优势是流媒体底座，而非单纯控件：官方支持 HLS、DASH、MSE、EME、Widevine/PlayReady/FairPlay、WebVTT/TTML/CEA 字幕，并能同时实现 sender 和 receiver。[Shaka 官方 README 与支持矩阵](https://github.com/shaka-project/shaka-player/blob/0ee962d613ce1331fe5e4d23433b596ee3adce85/README.md)；[Shaka UI Cast 配置](https://github.com/shaka-project/shaka-player/blob/0ee962d613ce1331fe5e4d23433b596ee3adce85/docs/tutorials/ui.md)

## 部署与片源限制

无论选择哪个播放器，都必须满足以下条件：

1. **接收端可直连媒体。** Chromecast/Google TV 请求的是 m3u8/MP4 URL，不会复用 MoonTV 浏览器里的 Cookie、代理、梯子或 hls.js 自定义 loader。需要 Cookie、Referer、特殊 Header、登录态或地区网络的源可能失败。
2. **CORS 正确。** HLS manifest、分片、密钥、字幕、封面都要允许接收端访问；仅在 `<video crossOrigin="anonymous">` 上设置属性不会替源站补充 CORS 响应头。[Google Cast 媒体文档](https://developers.google.com/cast/docs/media)
3. **HTTPS 与混合内容。** Cloudflare Pages 页面是 HTTPS；媒体与字幕应尽量全链路 HTTPS，避免本地播放被 Mixed Content 拦截。页面的 CSP 还必须允许加载 `https://www.gstatic.com` Cast Sender SDK。[W3C Mixed Content](https://w3c.github.io/webappsec-mixed-content/)
4. **接收端能力。** Default Media Receiver 并不保证支持每个编码、封装、加密方式或私有 HLS 标签；必要时需要自建 Receiver。
5. **MoonTV 本地增强不会自然迁移。** 当前 `CustomHlsJsLoader` 会在浏览器端改写 m3u8，跳过片头片尾逻辑也运行在本地 Artplayer 事件上。接收端不会执行这些代码；Vidstack 可同步标准远端控制，但广告清理、私有请求头和自动跳过仍需单独设计接收端行为。[MoonTV HLS loader](../../src/app/play/page.tsx#L440-L595)
6. **用户手势。** Remote Playback 的设备选择必须由点击等瞬时用户激活触发，不能在页面加载后自动弹出。[W3C Remote Playback `prompt()`](https://w3c.github.io/remote-playback/#dom-remoteplayback-prompt)

## 推荐实施顺序

### 阶段 1：先验证“协议与片源”，不承诺全端

做一个不进入主播放路径的最小 Vidstack 原型，仅使用一个公开、CORS 正确的 HLS 和一个 MoonTV 真实片源，验证：

- iPhone/iPad Safari：AirPlay 按钮、选集切换、返回本地后的进度；
- Android Chrome：`video.remote` 可用性与设备选择；
- 桌面 Chrome/Edge：Google Cast 设备发现、播放/暂停、seek、断线恢复；
- Firefox/Android WebView：正确隐藏不可用按钮；
- HarmonyOS Browser：记录 `video.remote`、Cast SDK 和系统投屏实际表现，不把 Chromium UA 当作成功证据；
- Chromecast/Google TV：至少抽测 10 个不同视频源，分类 CORS、编码、防盗链、网络不可达和鉴权失败。

### 阶段 2：建立播放器适配层

把页面业务从 Artplayer API 中剥离为稳定接口，例如 `load`、`play/pause`、`seek`、`setRate`、`getState`、`onTimeUpdate`、`requestAirPlay`、`requestGoogleCast`。先让 Artplayer 和 Vidstack 同时实现，功能开关灰度，不直接在 1,982 行页面内替换所有事件。

必须回归 MoonTV 已有能力：自动下一集、换源、播放进度、倍速、画中画、全屏/横屏锁定、iOS 原生播放、选集面板、跳过片头片尾、HLS 错误恢复和去广告 loader。

### 阶段 3：根据验证结果定终局

- 普通 HLS + 跨端投屏为主：切到 **Vidstack**。
- DRM/DASH/自建 Receiver 成为明确需求：评估 **Shaka Player**。
- 若真实片源大面积无法被接收端直连：先解决媒体代理/CORS/鉴权设计；继续换播放器没有收益。
- HarmonyOS 必须一键控制 Cast+/DLNA：需要原生 HarmonyOS 客户端或壳层桥接，不能把目标限定为 Cloudflare Pages 纯 Web。

## 最终推荐

**推荐 Vidstack，但先做真实设备原型，再决定全量迁移。**

它比 Artplayer 官方 Chromecast 插件更完整地管理远端播放器，也比 Video.js/Plyr/DPlayer 更少依赖第三方 Cast 插件；相比 Shaka，它更贴近 MoonTV 当前的 React UI 和普通 HLS 需求。项目已有依赖和历史实现，迁移并非从零开始。

同时应把产品文案从笼统的“投屏”拆成可验证能力：

- Apple 设备显示“AirPlay”；
- 支持的 Chromium 显示“Google Cast”；
- 浏览器不支持时显示“使用系统投屏/镜像”的帮助，而不是一个必然失败的按钮；
- HarmonyOS 的 Cast+/DLNA 作为原生能力另立需求。

这样能避免把协议生态和片源可达性问题误判成播放器缺陷。
