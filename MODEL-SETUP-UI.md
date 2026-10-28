# 本机模型设置界面与后台接口 · 3.0.4

AI首次默认关闭。弹窗的“配置本机 AI”进入设置页，用户可下载一键CMD脚本，双击选择完整源码目录后安装桥接并显式准备默认模型。浏览器不会执行脚本；已有桥接可直接使用原有模型准备按钮。安装器仅在 `-PrepareModel` 下准备模型；普通安装跳过。下载脚本、进入设置或模型准备成功都不自动开启AI。

本文描述小电视助手 · BiliPlus 的设置/弹窗协议。运行环境安装与模型下载由后台和本机桥接负责；用户需先手动运行桥接安装脚本，并手动在Chrome加载extension目录。界面测试中的端口、存储和readiness使用替身；另有真实本机模型四任务后端验证，但不代表干净机器安装或Chrome全流程已验收。

## 配置

保持备份 `schema:2`、`format:bilibili-codex-settings`、`version:2` 的兼容格式，增加：

| 键              | 默认值     | 可选值                               |
| --------------- | ---------- | ------------------------------------ |
| `ai.provider`   | `local`    | `local`、`codex`                     |
| `ai.localModel` | `qwen3:4b` | `qwen3:1.7b`、`qwen3:4b`、`qwen3:8b` |

旧备份缺少这两项时采用本机模型默认值；非法字符串会拒绝规范化/导入，不会自动选用 Codex。选择 Codex 必须由用户显式操作。设置页使用“字幕与总结”“内容处理方式”等任务文案；品牌统一为“小电视助手 · BiliPlus”。

默认模型为Ollama `qwen3:4b`，约4B参数、Q4_K_M量化、模型文件约2.5GB；无需账号，内容在本机处理。缺失运行环境时，后台从官方下载并验证Ollama安装器的Authenticode签名和发布者，执行用户级安装，再流式拉取模型；界面展示真实阶段与进度。选择 Codex 后隐藏本机模型选择与准备区，说明需要已有登录和可用额度，不会在本机模型失败后自动切换服务。

## 检查接口

模型检查按钮、维护页检查以及 popup 检查发送：

```js
{ type: "check", provider: "local", model: "qwen3:4b" }
```

所选模型可能尚未保存，因此后台应检查消息中的显式 provider/model，并进行白名单校验。预期返回：

```js
{
  ok: true,
  provider: "local",
  localRuntimeReady: true,
  localModelReady: true,
  localModel: "qwen3:4b",
  asrReady: false, // 与文本模型状态独立
  version: "..."
}
```

只有 runtime/model readiness 严格为布尔 `true`，且返回模型与所选模型完全一致，界面才显示本机模型“已就绪”。缺少字段、字符串 `"true"`、模型不匹配或服务不匹配均不会显示就绪。缺少状态只显示“尚未确认”，不会把旧版桥接的 `ok:true` 当作模型已安装。选择改变后，先前未完成的检查结果不会覆盖新选择。

## 下载与配置端口

```js
const port = chrome.runtime.connect({ name: "bili-model-setup" });
port.postMessage({
  type: "setup-local-model",
  model: "qwen3:4b",
  id: "随机任务ID",
});
```

准备过程中禁用 provider/model 选择和重复开始/检查按钮，保留取消按钮。进度使用原生 `<progress>`，没有数值时保持不确定状态。支持：

```js
{ type: "progress", stage: "local-pulling", status: "正在下载模型", completed: 25, total: 100 }
{ type: "progress", stage: "local-pulling", status: "正在下载模型", percent: 25 }
{ type: "result", result: { model: "qwen3:4b", ready: true } }
{ type: "error", error: "具体失败原因" }
```

返回包可以省略 id；提供 id 时必须与活动任务一致，旧任务消息会被忽略。percent 必须为 0–100 的有限数值，或由 completed/total 计算；错误数值、空进度、未知 type、ready 非 true 或模型与请求不符均显示错误并断开端口。所有文字按纯文本渲染。后台发送 result 后可以正常断开端口，界面不会把已经确认的结果误判为下载中断。

用户取消、离开页面、恢复默认配置或成功导入另一份配置时：

```js
port.postMessage({ type: "cancel", id: "原任务ID" });
port.disconnect();
```

晚到的 progress/result 不会恢复已取消任务。验证失败的导入不会取消已有准备任务，也不会修改原设置。

## 准备成功后的配置保存

收到所选模型的明确 ready 结果后，界面读取最新已保存设置，仅更新并保存：

```js
biliSettings.ai.provider = "local";
biliSettings.ai.localModel = "本次准备的模型";
```

后台无需再次改写完整 biliSettings。其他未保存的界面修改仍留在界面中，并提示用户另点“保存设置”；不会随着模型准备成功而被悄悄保存。若模型已准备但存储写入失败，界面明确显示“模型已准备，但配置保存失败”，不会声称自动配置完成或切换到 Codex。

## 元素定位

| ID / 属性                                                | 用途                              |
| -------------------------------------------------------- | --------------------------------- |
| `[data-key="ai.provider"]`、`[data-key="ai.localModel"]` | 服务与模型选择                    |
| `#model-provider-note`                                   | 随 provider 改变的说明            |
| `#model-setup-controls`                                  | 仅本机模式可见的准备区            |
| `#model-setup-start`                                     | 下载并配置本地模型                |
| `#model-setup-check`                                     | 检查所选模型                      |
| `#model-setup-cancel`                                    | 取消活动任务                      |
| `#model-setup-progress`                                  | 原生下载进度                      |
| `#model-setup-status`                                    | 进度、就绪与错误状态，role=status |

## 测试

`tests/qa-home-settings.test.cjs` 的 QAHS-24–33 覆盖默认值/三模型备份、严格 provider 验证、缺字段不假报就绪、端口/进度、成功自动配置与未保存修改隔离、取消/晚响应、错误/断线/旧id、Codex显式选择、检查晚响应、导入/默认/页面退出取消、连接与存储失败及 popup 文案。

HS-3 事务修复由 QAHS-15 和 QAHS-31 覆盖：先完成 `C.restore` 与背景校验，再一起替换 config/localBackground；任何验证失败不改变内部配置、当前界面或活动准备任务。

## 文字任务边界

模型准备与文字生成是不同阶段。`native/local-model.cjs`在生成前计算完整prompt的UTF-8总字节数，包含系统和任务提示词、标题、字幕、问题与问答历史，最多28,000字节。超限明确拒绝，不静默截断，不自动分块。准备就绪不表示任何输入都可处理，也不表示独立ASR已安装。

CLI `native/setup-local.cjs`使用同一个prepare实现；支持`--model`、`--json`和Ctrl+C。正常退出0，失败1，取消130。NativeHost将helper的严格runtimeReady/modelReady映射成UI的ready；不能仅凭进度到100%或连接成功显示模型已就绪。
