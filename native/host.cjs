"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const {
  VERSION,
  normalizeInput,
  runCodex,
  inputHash,
  makePrompt,
  validateResult,
} = require("./runner.cjs");
const asr = require("./asr.cjs");
const localModel = require("./local-model.cjs");
const tasks = require("./tasks.cjs");
const MAX = 1024 * 1024;
function encode(message) {
  const data = Buffer.from(JSON.stringify(message), "utf8");
  if (data.length > MAX) throw Error("响应过大");
  const head = Buffer.alloc(4);
  head.writeUInt32LE(data.length);
  return Buffer.concat([head, data]);
}
function start(
  input = process.stdin,
  output = process.stdout,
  config = JSON.parse(
    fs.readFileSync(path.join(__dirname, "runtime.json"), "utf8"),
  ),
) {
  let buffered = Buffer.alloc(0),
    active = null;
  const send = (message) => output.write(encode(message));
  const diagnostics = (detail) => {
    try {
      fs.writeFileSync(
        path.join(__dirname, "last-status.json"),
        JSON.stringify(
          { version: VERSION, at: new Date().toISOString(), ...detail },
          null,
          2,
        ),
      );
    } catch {}
  };
  const receive = async (message) => {
    if (!message || typeof message !== "object") {
      send({ id: "", type: "error", error: "消息格式无效。" });
      return;
    }
    const id = typeof message.id === "string" ? message.id.slice(0, 80) : "";
    if (message.type === "cancel") {
      if (active?.id === id) active.controller.abort();
      return;
    }
    if (message.type === "status") {
      const provider = message.provider || "local";
      if (!["local", "codex"].includes(provider)) {
        send({ id, type: "error", error: "模型服务类型无效。" });
        return;
      }
      let local;
      try {
        local = await localModel.status({
          model: message.model || localModel.DEFAULT_MODEL,
        });
      } catch (error) {
        send({ id, type: "error", error: error.message });
        return;
      }
      send({
        id,
        type: "status",
        version: VERSION,
        ready: true,
        provider,
        localRuntimeReady: local.runtimeReady,
        localModelReady: local.modelReady,
        localModel: local.model,
        codexInstalled: !!config.codexPath && fs.existsSync(config.codexPath),
        asrReady: asr.available(),
        capabilities: ["summary", "chat", "ads", "polish", "transcribe"],
      });
      return;
    }
    if (
      ![
        "summarize",
        "chat",
        "ads",
        "polish",
        "transcribe",
        "setup-local-model",
      ].includes(message.type)
    ) {
      send({ id, type: "error", error: "不支持的请求。" });
      return;
    }
    if (active) {
      send({ id, type: "error", error: "上一条总结仍在生成，请先取消。" });
      return;
    }
    const controller = new AbortController();
    active = { id, controller };
    const started = Date.now();
    let video, localMetrics;
    try {
      const kind = message.type === "summarize" ? "summary" : message.type;
      if (kind === "setup-local-model") {
        const ready = await localModel.prepare({
          model: message.model || localModel.DEFAULT_MODEL,
          signal: controller.signal,
          onProgress: (progress) => send({ id, type: "progress", ...progress }),
        });
        send({
          id,
          type: "result",
          result: { ...ready, ready: ready.runtimeReady && ready.modelReady },
        });
        return;
      }
      const provider = message.provider || "local";
      if (!["local", "codex"].includes(provider))
        throw Error("模型服务类型无效。");
      video =
        kind === "transcribe" ? message.input : normalizeInput(message.input);
      const hash = inputHash(
        kind === "transcribe"
          ? { bvid: video?.bvid, cid: video?.cid, duration: video?.duration }
          : video,
      );
      diagnostics({
        status: "running",
        kind,
        bvid: video?.bvid,
        cid: video?.cid,
        subtitleCount: video?.subtitles?.length,
        inputHash: hash,
      });
      send({
        id,
        type: "progress",
        stage: kind === "transcribe" ? "downloading" : "generating",
        subtitleCount: video?.subtitles?.length,
      });
      const output =
        kind === "transcribe"
          ? {
              result: await asr.transcribe(message.input, {
                signal: controller.signal,
                onProgress: (progress) =>
                  send({ id, type: "progress", ...progress }),
              }),
            }
          : provider === "codex"
            ? await runCodex(video, {
                config,
                kind,
                taskData: message.taskData,
                signal: controller.signal,
              })
            : {
                result: await (async () => {
                  const taskData = tasks.prepare(kind, message.taskData);
                  const result = await localModel.runLocal({
                    input: video,
                    kind,
                    taskData,
                    model: message.model || localModel.DEFAULT_MODEL,
                    prompt: makePrompt(video, kind, taskData),
                    schema: JSON.parse(
                      fs.readFileSync(tasks.schemaFile(kind), "utf8"),
                    ),
                    signal: controller.signal,
                    onProgress: (progress) => {
                      if (progress.stage === "local-complete")
                        localMetrics = progress.metrics;
                      send({ id, type: "progress", ...progress });
                    },
                  });
                  return kind === "summary"
                    ? validateResult(result, video.duration)
                    : tasks.validate(kind, result, video.duration);
                })(),
              };
      const { result, usage } = output;
      const meta = {
        elapsedMs: Date.now() - started,
        subtitleCount:
          video?.subtitles?.length || result.subtitles?.length || 0,
        inputHash: hash,
        generatedAt: new Date().toISOString(),
        kind,
        localMetrics,
        provider: kind === "transcribe" ? "local-asr" : provider,
        model:
          provider === "local"
            ? message.model || localModel.DEFAULT_MODEL
            : undefined,
      };
      diagnostics({
        status: "success",
        kind,
        bvid: video?.bvid,
        cid: video?.cid,
        ...meta,
        summaryCharacters: result.summary?.length,
        segments: result.segments?.length,
        usage,
      });
      send({ id, type: "result", result, meta });
    } catch (e) {
      const error = e.message || "生成失败。";
      diagnostics({
        status: "error",
        bvid: video?.bvid,
        elapsedMs: Date.now() - started,
        error,
      });
      send({ id, type: "error", error });
    } finally {
      active = null;
    }
  };
  input.on("data", (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= 4) {
      const length = buffered.readUInt32LE(0);
      if (!length || length > MAX) {
        active?.controller.abort();
        input.destroy();
        return;
      }
      if (buffered.length < length + 4) break;
      const body = buffered.subarray(4, length + 4);
      buffered = buffered.subarray(length + 4);
      try {
        void receive(JSON.parse(body.toString("utf8")));
      } catch {
        send({ id: "", type: "error", error: "消息格式无效。" });
      }
    }
  });
  input.on("end", () => {
    active?.controller.abort();
  });
  return { receive };
}
if (require.main === module) {
  try {
    const config = JSON.parse(
      fs.readFileSync(path.join(__dirname, "runtime.json"), "utf8"),
    );
    if (process.argv[2] !== config.extensionOrigin) process.exitCode = 1;
    else start(process.stdin, process.stdout, config);
  } catch {
    process.exitCode = 1;
  }
}
module.exports = { encode, start };
