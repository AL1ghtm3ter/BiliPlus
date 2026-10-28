# 第三方来源与许可证说明 · 3.0.0

核对日期：2026-10-28。小电视助手 · BiliPlus 的独立源码按 [MIT License](LICENSE) 发布。第三方软件、模型、媒体与商标遵循各自许可；本文摘要不能替代发行包附带的完整 LICENSE、版权、NOTICE 或二进制第三方说明。

## 独立源码与公开分发

本项目是独立实现，不是 Bilibili Helper 的官方版本。项目 MIT 只涵盖本项目有权许可的独立源码，不适用于其他插件、B站内容或第三方模型；不能据此推定原插件开源或可再分发。

公开源码包不包含原插件 ZIP、混淆代码、派生切片、个人历史验收截图或日志，也不提供其账号、VIP、积分或中转服务。开发分析工具不作为运行依赖或第三方代码合入。

源码包不附带 Node/Ollama 安装程序、模型、Python 环境、Codex CLI、node_modules 或机器配置。安装器从对应上游获取运行环境和模型；取得这些文件后仍须遵守、保留其原始许可。另行分发运行时或权重前，应检查全部组成部分的再分发要求。

## 默认文本模型与运行环境

| 组件                  | 来源与许可边界                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ollama                | 上游核心仓库为 [MIT 许可](https://github.com/ollama/ollama/blob/main/LICENSE)。Windows 发行版可能含其他组件，依发行包许可与说明；源码包不重新分发安装器 |
| Qwen3:4b              | [Ollama 官方模型页](https://ollama.com/library/qwen3:4b)标示约 4.02B 参数、Q4_K_M、2.5GB 及 Apache-2.0 许可。模型独立下载，不能改标为本项目 MIT         |
| qwen3:1.7b / qwen3:8b | 可选模型标签，具体元数据和许可以所选标签随附文件为准                                                                                                    |
| Node.js 24            | [官方分发目录](https://nodejs.org/dist/latest-v24.x/)的 Windows x64 ZIP，安装时核对同目录 SHASUMS256；完整 LICENSE 与第三方说明随其发行版保留           |

Ollama 安装仅接受受限上游分发地址，执行前验证 Windows Authenticode 签名状态及发布者。SHA256 或签名校验用于检查来源完整性，不改变许可证。文本模型环境与可选 ASR 环境分别安装。

## JavaScript 开发依赖

运行扩展不需要 npm 依赖；Node 桥接仅使用 Node 内置模块。下面是锁定的开发工具及 LinkeDOM 的依赖链，许可证摘要依据锁定依赖的 package metadata；完整许可在各发行包中。开发依赖进入 `node_modules` 后，完整许可位于各包自身目录。

| 组件与版本                                             | 用途              | 已核对的许可证 / 来源                                                                                                                                                    |
| ------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Prettier 3.6.2                                         | 源码格式检查      | MIT；[prettier/prettier](https://github.com/prettier/prettier)。                                                                                                         |
| LinkeDOM 0.18.12                                       | 模拟 DOM 测试     | ISC；包内 LICENSE 为准；[WebReflection/linkedom](https://github.com/WebReflection/linkedom)。                                                                            |
| boolbase 1.0.0                                         | LinkeDOM 间接依赖 | ISC；[fb55/boolbase](https://github.com/fb55/boolbase)。                                                                                                                 |
| css-select 5.2.2、css-what 6.2.2、nth-check 2.1.1      | 选择器支持        | BSD-2-Clause；[css-select](https://github.com/fb55/css-select)、[css-what](https://github.com/fb55/css-what)、[nth-check](https://github.com/fb55/nth-check)。           |
| cssom 0.5.0                                            | CSS 对象模型      | MIT；[NV/CSSOM](https://github.com/NV/CSSOM)。                                                                                                                           |
| dom-serializer 2.0.0                                   | DOM 序列化        | MIT；[cheeriojs/dom-serializer](https://github.com/cheeriojs/dom-serializer)。                                                                                           |
| domelementtype 2.3.0、domhandler 5.0.3、domutils 3.2.2 | DOM 工具          | BSD-2-Clause；[domelementtype](https://github.com/fb55/domelementtype)、[domhandler](https://github.com/fb55/domhandler)、[domutils](https://github.com/fb55/domutils)。 |
| entities 4.5.0 与 7.0.1                                | HTML 实体         | BSD-2-Clause；[fb55/entities](https://github.com/fb55/entities)。                                                                                                        |
| html-escaper 3.0.3、htmlparser2 10.1.0                 | HTML 转义与解析   | MIT；[html-escaper](https://github.com/WebReflection/html-escaper)、[htmlparser2](https://github.com/fb55/htmlparser2)。                                                 |
| uhyphen 0.2.0                                          | 名称转换          | ISC；[WebReflection/uhyphen](https://github.com/WebReflection/uhyphen)。                                                                                                 |

Prettier 自身可能包含内嵌第三方代码，其包内完整 LICENSE 应一并保留。上表不是这些工具的开发依赖树，也不表示本扩展在浏览器里加载了它们。

## 本机语音环境

直接依赖为 [SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper) 1.2.1。本次已检查其 `faster_whisper-1.2.1.dist-info/LICENSE`：MIT，版权归 SYSTRAN。模型推理由 CTranslate2 执行，音频读取通过 PyAV；识别配置为 CPU int8。

下表对应可选 ASR 锁定环境的 distribution metadata，与 [requirements-asr.lock.txt](native/requirements-asr.lock.txt) 对应。标为“元数据”的项仅确认了安装包声明，未进行完整的传递依赖或二进制授权审计。

| 安装包            | 版本     | 本次核查结果                                                                                                                                    |
| ----------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| faster-whisper    | 1.2.1    | MIT，已读取 LICENSE。                                                                                                                           |
| ctranslate2       | 4.8.4    | 元数据为 MIT；本轮未发现单独许可证文件，需遵循 [OpenNMT/CTranslate2](https://github.com/OpenNMT/CTranslate2) 原始许可。                         |
| av                | 18.1.0   | BSD-3-Clause，已读取包内 LICENSE.txt；所链接/附带的 FFmpeg 等库另遵循自身原始许可证。                                                           |
| onnxruntime       | 1.31.1   | MIT，已读取包内 LICENSE；另有 `onnxruntime/ThirdPartyNotices.txt`，再分发时须保留并核查。                                                       |
| huggingface-hub   | 2.3.0    | 元数据：Apache-2.0；来源 [huggingface/huggingface_hub](https://github.com/huggingface/huggingface_hub)。                                        |
| hf-xet            | 1.7.0    | 元数据：Apache-2.0。                                                                                                                            |
| tokenizers        | 0.23.3   | 本轮安装元数据未给出许可证且未发现许可文件；需遵循 [huggingface/tokenizers](https://github.com/huggingface/tokenizers) 原始许可证，本文不推定。 |
| numpy             | 2.4.6    | 元数据：BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0；包内包含多份依赖许可。                                                              |
| anyio             | 4.15.1   | 元数据：MIT。                                                                                                                                   |
| click             | 8.5.0    | 元数据：BSD-3-Clause。                                                                                                                          |
| colorama          | 0.4.6    | 已读取许可证文件，BSD 三条款文本。                                                                                                              |
| filelock          | 4.2.4    | 元数据：MIT。                                                                                                                                   |
| flatbuffers       | 25.12.19 | 元数据：Apache 2.0。                                                                                                                            |
| fsspec            | 2026.9.0 | 元数据：BSD-3-Clause。                                                                                                                          |
| h11               | 0.16.0   | 元数据：MIT。                                                                                                                                   |
| httpcore2、httpx2 | 2.16.0   | 元数据：BSD-3-Clause。                                                                                                                          |
| idna              | 3.20     | 元数据：BSD-3-Clause。                                                                                                                          |
| packaging         | 26.3     | 元数据：Apache-2.0 OR BSD-2-Clause。                                                                                                            |
| protobuf          | 7.36.2   | 元数据：3-Clause BSD License。                                                                                                                  |
| PyYAML            | 6.0.3    | 元数据：MIT。                                                                                                                                   |
| tqdm              | 4.70.1   | 元数据：MPL-2.0 AND MIT。                                                                                                                       |
| truststore        | 0.10.5   | 元数据：MIT。                                                                                                                                   |
| typing-extensions | 4.16.0   | 元数据：PSF-2.0。                                                                                                                               |

这些条目不代表全部组件使用同一许可证。每个包的发行来源与许可信息可在其 Python distribution metadata 和原始仓库核对；不能将本表中未核查的二进制组成部分自动按上层 Python 包的许可证处理。

## 语音模型

安装脚本请求 [Systran/faster-whisper-small](https://huggingface.co/Systran/faster-whisper-small) 或 [Systran/faster-whisper-base](https://huggingface.co/Systran/faster-whisper-base)，即用于 faster-whisper 的转换模型。其上游为 [OpenAI Whisper](https://github.com/openai/whisper)。

源码分发不附带语音权重。模型、分词器与转换产物须遵循对应模型仓库及上游原始许可；另行分发前应取得并保留模型卡、LICENSE 等必要文件。本项目 MIT 不重新许可这些权重。

## 外部工具与站点

- **uv 与 Python**：用于可选语音环境；来源 [Astral uv](https://docs.astral.sh/uv/) 与 [Python](https://www.python.org/)，依各发行版许可。
- **Codex CLI 与模型服务**：显式可选，由用户自行安装、登录；来源 [OpenAI Codex](https://github.com/openai/codex)。CLI 许可与服务条款分别适用，本项目不重新分发 CLI 或登录信息。
- **Chrome 与 Windows .NET Framework**：用户本机软件。安装脚本调用系统编译器生成本项目 Launcher.cs，不将系统组件复制进源码包。
- **B站接口与媒体**：视频、字幕、封面、评论和音频属于相应权利人。账号能够访问不等于取得内容再分发许可，功能仍受会员、付费和区域权限约束。

字幕兼容代码仅实现读取站点返回数据所需的协议处理，不将B站播放器程序打包为项目源码。B站、Chrome、Ollama、Qwen、Codex 等名称与标识分别归对应权利人，提及不表示合作或背书。
