"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const runtime = path.resolve(__dirname, "../.runtime");
function audioUrl(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    throw Error("音轨地址无效。");
  }
  if (
    u.protocol !== "https:" ||
    u.port ||
    u.username ||
    u.password ||
    !["bilivideo.com", "bilivideo.cn"].some(
      (host) => u.hostname === host || u.hostname.endsWith("." + host),
    )
  )
    throw Error("只允许读取 B站当前可播放的 HTTPS 音轨。");
  return u.href;
}
function asrConfig() {
  const file = path.join(runtime, "asr.json");
  if (!fs.existsSync(file))
    throw Error("本机转写尚未安装，请运行“安装本机转写.ps1”。");
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  if (
    !fs.existsSync(config.python) ||
    !fs.existsSync(path.join(config.modelPath, "model.bin"))
  )
    throw Error("本机识别模型不完整，请重新运行安装脚本。");
  return config;
}
function available() {
  try {
    asrConfig();
    return true;
  } catch {
    return false;
  }
}
async function download(url, file, signal, onProgress) {
  let response;
  for (let hop = 0; hop < 4; hop++) {
    response = await fetch(audioUrl(url), {
      signal,
      redirect: "manual",
      headers: {
        "User-Agent": "BilibiliCodex/2.0 local-audio-transcriber",
        Referer: "https://www.bilibili.com/",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      await response.body?.cancel();
      if (!next) throw Error("音轨跳转无效。");
      url = new URL(next, url).href;
      continue;
    }
    break;
  }
  if (!response?.ok || !response.body)
    throw Error("音轨下载失败，请刷新视频页后重试。");
  const limit = 512 * 1024 * 1024,
    length = Number(response.headers.get("content-length") || 0);
  if (length > limit) {
    await response.body.cancel();
    throw Error("音轨超过本版 512MB 上限。");
  }
  const handle = await fs.promises.open(file, "wx");
  let count = 0,
    last = 0;
  try {
    for await (const chunk of response.body) {
      count += chunk.length;
      if (count > limit) throw Error("音轨超过本版 512MB 上限。");
      let offset = 0;
      while (offset < chunk.length) {
        const written = await handle.write(
          chunk,
          offset,
          chunk.length - offset,
        );
        if (!written.bytesWritten) throw Error("音轨写入失败。");
        offset += written.bytesWritten;
      }
      if (Date.now() - last > 1200) {
        last = Date.now();
        onProgress?.({
          stage: "downloading",
          bytes: count,
          totalBytes: length,
        });
      }
    }
  } finally {
    await handle.close();
  }
}
async function transcribe(
  input,
  { signal, onProgress, config: provided } = {},
) {
  if (
    !input ||
    !/^BV[0-9A-Za-z]{10}$/.test(input.bvid) ||
    !/^\d+$/.test(String(input.cid)) ||
    !Number.isFinite(input.duration) ||
    input.duration <= 0 ||
    input.duration > 7200
  )
    throw Error("本机转写单次支持 2 小时以内的视频分 P。");
  const config = provided || asrConfig(),
    url = audioUrl(input.audioUrl);
  const folder = path.join(runtime, "tmp");
  await fs.promises.mkdir(folder, { recursive: true });
  const file = path.join(folder, crypto.randomUUID() + ".m4a");
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 30 * 60000);
  try {
    onProgress?.({ stage: "downloading" });
    await download(url, file, controller.signal, onProgress);
    return await new Promise((resolve, reject) => {
      let settled = false,
        buffer = "",
        result,
        child;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        controller.signal.removeEventListener("abort", cancel);
        if (error) {
          child?.kill();
          reject(error);
        } else resolve(value);
      };
      const cancel = () => finish(Error("本机转写已取消或超过 30 分钟。"));
      if (controller.signal.aborted) {
        cancel();
        return;
      }
      controller.signal.addEventListener("abort", cancel, { once: true });
      child = spawn(config.python, [path.join(__dirname, "asr.py")], {
        windowsHide: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONIOENCODING: "utf-8", HF_HUB_OFFLINE: "1" },
      });
      child.on("error", () =>
        finish(Error("本机转写环境无法启动，请重新安装。")),
      );
      child.stdin.on("error", () => {});
      child.stderr.resume();
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        buffer += chunk;
        if (buffer.length > 1024 * 1024) {
          finish(Error("转写结果过大。"));
          return;
        }
        let n;
        while ((n = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, n);
          buffer = buffer.slice(n + 1);
          let message;
          try {
            message = JSON.parse(line);
          } catch {
            continue;
          }
          if (message.type === "progress") onProgress?.(message);
          if (message.type === "result") result = message;
          if (message.type === "error") finish(Error(message.error));
        }
      });
      child.on("close", (code) => {
        if (settled) return;
        if (code !== 0 || !result?.subtitles?.length) {
          finish(Error("没有识别到有效语音，请确认视频有人声。"));
          return;
        }
        const subtitles = result.subtitles
          .filter(
            (s) =>
              Number.isFinite(s.start) &&
              Number.isFinite(s.end) &&
              s.start >= 0 &&
              s.start < input.duration &&
              s.end > s.start &&
              typeof s.text === "string",
          )
          .map((s) => ({ ...s, end: Math.min(s.end, input.duration) }));
        if (!subtitles.length) {
          finish(Error("没有识别到有效语音。"));
          return;
        }
        finish(null, {
          bvid: input.bvid,
          cid: String(input.cid),
          title: String(input.title || ""),
          duration: input.duration,
          subtitles,
          language: result.language,
          source: "local-asr",
        });
      });
      child.stdin.end(
        JSON.stringify({
          audioFile: file,
          modelPath: config.modelPath,
          language: ["zh", "en", "ja", "ko"].includes(input.language)
            ? input.language
            : "auto",
        }),
      );
    });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
    await fs.promises.rm(file, { force: true }).catch(() => {});
  }
}
module.exports = { audioUrl, asrConfig, available, download, transcribe };
