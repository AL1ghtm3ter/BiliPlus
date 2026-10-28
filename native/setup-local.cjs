"use strict";
const localModel = require("./local-model.cjs");
function selectedModel(argv) {
  let model = localModel.DEFAULT_MODEL;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") continue;
    if (argv[i] !== "--model" || !argv[i + 1])
      throw Error(
        "用法：node native/setup-local.cjs [--model qwen3:4b] [--json]",
      );
    model = argv[++i];
  }
  if (!localModel.MODELS.includes(model))
    throw Error("请选择 qwen3:1.7b、qwen3:4b 或 qwen3:8b。");
  return model;
}
async function main(argv = process.argv.slice(2), dependencies = {}) {
  const output = dependencies.stdout || process.stdout,
    errors = dependencies.stderr || process.stderr,
    signals = dependencies.signals || process,
    prepare = dependencies.prepare || localModel.prepare,
    controller = new AbortController(),
    json = argv.includes("--json");
  let lastProgress = "";
  const cancel = () => {
    const error = Error("用户取消模型准备。");
    error.name = "AbortError";
    controller.abort(error);
  };
  const emit = (value) => {
    if (json) {
      output.write(JSON.stringify(value) + "\n");
      return;
    }
    const percent = Number.isFinite(value.percent)
      ? value.percent
      : Number.isFinite(value.completed) &&
          Number.isFinite(value.total) &&
          value.total > 0
        ? (value.completed / value.total) * 100
        : undefined;
    const line =
      "[" +
      (value.stage || "model") +
      "] " +
      (value.status || "正在准备") +
      (percent === undefined
        ? ""
        : " " + Math.max(0, Math.min(100, Math.round(percent))) + "%");
    if (line !== lastProgress) {
      output.write(line + "\n");
      lastProgress = line;
    }
  };
  signals.on("SIGINT", cancel);
  signals.on("SIGTERM", cancel);
  try {
    const model = selectedModel(argv);
    emit({
      type: "progress",
      stage: "checking",
      status: "正在检查本机模型与运行环境；Ctrl+C 可取消。",
      model,
    });
    if (!json)
      output.write(
        model +
          " 文本模型" +
          (model === "qwen3:4b" ? "首次约下载 2.5GB" : "下载量取决于所选模型") +
          "；已有运行环境和模型将直接复用，无需 Codex 账号。\n",
      );
    const result = await prepare({
      model,
      signal: controller.signal,
      onProgress: (state) => emit({ type: "progress", ...state }),
    });
    if (controller.signal.aborted) throw controller.signal.reason;
    if (
      result?.runtimeReady !== true ||
      result?.modelReady !== true ||
      result?.model !== model
    )
      throw Error("本机模型就绪状态未通过校验，请重试。");
    if (json)
      output.write(
        JSON.stringify({
          type: "result",
          result: { model, ready: true, runtimeReady: true, modelReady: true },
        }) + "\n",
      );
    else
      output.write(
        "[ready] " +
          model +
          " 文本模型已就绪，可使用字幕总结与问答。语音转写仍是独立可选功能，本结果不表示 ASR 已安装。\n",
      );
    return 0;
  } catch (error) {
    const cancelled = controller.signal.aborted || error?.name === "AbortError",
      message = cancelled
        ? "模型准备已取消；可重新运行安装脚本继续。"
        : "模型准备失败：" + (error?.message || "未知错误");
    if (json)
      output.write(
        JSON.stringify({ type: "error", error: message, cancelled }) + "\n",
      );
    else errors.write(message + "\n");
    return cancelled ? 130 : 1;
  } finally {
    signals.removeListener("SIGINT", cancel);
    signals.removeListener("SIGTERM", cancel);
  }
}
if (require.main === module)
  main().then((code) => {
    process.exitCode = code;
  });
module.exports = { main, selectedModel };
