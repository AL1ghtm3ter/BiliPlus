# 小电视助手 · BiliPlus 品牌资产

标识为独立绘制的几何小电视：粉色圆角机身、浅粉白屏幕、深莓色五官、短天线和支脚。没有外部位图、字体或官网图案，背景透明。图形中不含 AI 或 local 文字。

矢量源为 `extension/common/brand.svg`，128×128 viewBox。浏览器界面可直接缩放使用。扩展图标为 `extension/icons/icon16.png`、`icon32.png`、`icon48.png`、`icon128.png`，均为对应尺寸的 RGBA PNG。

只编辑 SVG 的几何参数，再运行：

```powershell
python scripts/render-icons.py
```

生成脚本读取 SVG 中的矩形、直线和折线，以 8 倍采样绘制，再使用预乘 alpha 的 Lanczos 缩放；不会运行浏览器或联网。依赖 Pillow 10 或更新版本，本机生成环境为 Pillow 11.3.0。脚本打印源文件及每张图标的 SHA256、尺寸和透明度范围。新的 SVG 图元应先在脚本中明确支持；不支持的图元会报错，不会悄悄丢失。

机身主色 `#ff6699`，轮廓与五官 `#8b2a4c`，屏幕 `#fff7fa`。16px 仍保留两根天线、电视轮廓、两只眼睛和短笑脸；此尺寸不附加文字或细小装饰。

本机连续两次渲染的四张 PNG 字节一致，四张均含完全透明与完全不透明像素，尺寸与文件名一致。已用浅色和深色底预览检查小图标轮廓与屏幕；机械检测无条目不代替这一步视觉检查。工作区生成记录保存在 `work/qa-full/logo-render.json`，预览为 `work/qa-full/logo-preview.png`。
