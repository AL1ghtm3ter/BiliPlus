# 架构 · 3.1.0

浏览器扩展由 Manifest V3 后台、主世界数据观察脚本和隔离世界功能脚本组成；没有本机桥接、模型、安装器或外部后台服务。

| 文件 | 职责 |
| --- | --- |
| `extension/background.js` | 检查调用方身份，只处理打开设置及固定 B站视频信息/预览接口；更新时清理旧助手数据 |
| `extension/capture.js` | 保持原生 fetch/XHR 的返回行为，观察必要的推荐、视频、公开评论数据；维护当前播放身份 |
| `extension/common/config.js` | 默认值、配置归一化、校验与备份兼容；忽略旧 AI 字段 |
| `extension/common/settings-fields.js` | 保留功能的详细字段声明 |
| `extension/common/ui.js` | 主题、本地图片及每日文字 |
| `extension/features/runtime.js` | 可释放事件/节点/定时器、组件工具和限域 CDN 图片地址校验 |
| `extension/features/player.js` | 倍速、快捷键、全屏进度及公开评论属地 |
| `extension/features/home.js` | 推荐历史、极简首页、加载优化、封面和悬停预览 |
| `extension/features/layout.js` | 右侧评论移动、宽度与还原 |
| `extension/features/filter.js` | 本地卡片过滤及界面净化 |
| `extension/features/index.js` | 完整初始化、设置变化、路由切换和功能清理 |
| `extension/popup.*` / `options.*` | 菜单与设置，无模型入口 |
| `scripts/` | 语法、构建、白名单打包和图标生成 |
| `tests/` | 合成数据与 DOM 的功能回归、迁移及后台消息检查 |

保留历史 `bili-codex-*` 事件名及旧备份格式标识，以避免无关兼容性变化；这些名称不代表存在模型接入。扩展公钥保留，扩展身份与旧版一致。

公开发布使用 `scripts/source-files.cjs` 的明确文件集。构建先清理固定的 `dist/extension` 目录，避免旧版 AI 文件留在构建产物中。ZIP 内含逐文件 SHA256；开发依赖、缓存、机器配置与历史测试材料不进入发布。
