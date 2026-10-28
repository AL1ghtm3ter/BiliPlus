"use strict";
importScripts("subtitles.js", "common/config.js");
const HOST = "local.bilibili_codex";
function validSender(sender) {
  try {
    const u = new URL(sender.url);
    return (
      sender.id === chrome.runtime.id &&
      u.protocol === "https:" &&
      u.hostname === "www.bilibili.com" &&
      BiliConfig.isPlaybackLocation(u) &&
      sender.frameId === 0
    );
  } catch {
    return false;
  }
}
function biliSender(sender) {
  try {
    const u = new URL(sender.url);
    return (
      sender.id === chrome.runtime.id &&
      u.protocol === "https:" &&
      ["www.bilibili.com", "search.bilibili.com"].includes(u.hostname) &&
      sender.frameId === 0
    );
  } catch {
    return false;
  }
}
function ownPage(sender) {
  try {
    const url = new URL(sender.url);
    return (
      sender.id === chrome.runtime.id &&
      url.protocol === "chrome-extension:" &&
      url.hostname === chrome.runtime.id &&
      (sender.frameId === undefined || sender.frameId === 0) &&
      ["/popup.html", "/options.html"].includes(url.pathname)
    );
  } catch {
    return false;
  }
}
async function getJSON(url, signal) {
  const cdn = new URL(url).hostname.endsWith(".hdslb.com");
  const response = await fetch(url, {
    credentials: cdn ? "omit" : "include",
    signal,
    redirect: "error",
  });
  if (!response.ok)
    throw Error("B站数据请求失败（" + response.status + "），请刷新页面重试。");
  return response.json();
}
async function settings() {
  const stored = await chrome.storage.local.get("biliSettings");
  return BiliConfig.normalize(stored.biliSettings);
}
async function videoInfo(snapshot, pageUrl, signal) {
  const url = new URL(pageUrl),
    expected =
      url.pathname.match(/\/video\/(BV[0-9A-Za-z]{10})/)?.[1] ||
      url.searchParams.get("bvid"),
    playlist = /^\/list\//.test(url.pathname);
  if (!BiliConfig.isPlaybackLocation(url)) throw Error("请在 B站视频页使用。");
  let bvid = playlist
    ? snapshot.bvid || (snapshot.aid ? "" : expected)
    : expected || snapshot.bvid;
  const aid = String(snapshot.aid || "");
  if (!/^BV[0-9A-Za-z]{10}$/.test(bvid || "")) bvid = "";
  if (!bvid && !/^\d{1,20}$/.test(aid))
    throw Error("尚未捕获播放列表的当前视频，请开始播放后重试。");
  let video = {
      bvid,
      aid: /^\d{1,20}$/.test(aid) ? aid : undefined,
      cid: String(snapshot.cid || ""),
      title: String(snapshot.title || "").slice(0, 500),
      duration: Number(snapshot.duration),
    },
    tracks = Array.isArray(snapshot.tracks) ? snapshot.tracks : [];
  if (
    playlist ||
    !bvid ||
    snapshot.bvid !== bvid ||
    !/^\d+$/.test(video.cid) ||
    !(video.duration > 0)
  ) {
    const info = await getJSON(
      "https://api.bilibili.com/x/web-interface/view?" +
        (bvid ? "bvid=" + bvid : "aid=" + aid),
      signal,
    );
    if (info.code !== 0) throw Error("无法读取视频信息，请刷新视频页后重试。");
    const page =
      playlist && snapshot.cid
        ? info.data?.pages?.find(
            (page) => String(page.cid) === String(snapshot.cid),
          )
        : info.data?.pages?.[Number(url.searchParams.get("p") || 1) - 1];
    if (!page) throw Error("找不到当前分 P。");
    video = {
      bvid: info.data.bvid || bvid,
      aid: String(info.data.aid || ""),
      cid: String(page.cid),
      title: info.data.title,
      duration: Number(page.duration),
    };
    tracks = [];
  }
  return { video, tracks };
}
async function signingKeys(signal) {
  const nav = await getJSON(
      "https://api.bilibili.com/x/web-interface/nav",
      signal,
    ),
    keys = nav.data?.wbi_img;
  if (!keys) throw Error("B站没有返回访问签名，请确认已经登录。");
  return keys;
}
async function signedQuery(params, signal, keysPromise) {
  const keys = await (keysPromise || signingKeys(signal));
  return BiliSubtitles.wbiQuery(params, keys.img_url, keys.sub_url);
}
async function modernSubtitleTracks(
  video,
  signal,
  getKeys = () => signingKeys(signal),
) {
  const aidPromise = (async () => {
    if (/^\d{1,20}$/.test(video.aid || "")) return video.aid;
    const info = await getJSON(
      "https://api.bilibili.com/x/web-interface/view?bvid=" + video.bvid,
      signal,
    );
    if (info.code !== 0 || !/^\d{1,20}$/.test(String(info.data?.aid || "")))
      throw Error("无法读取当前视频的字幕信息。");
    return String(info.data.aid);
  })();
  // These requests are independent; share only this load's keys, not a global
  // login-sensitive cache, and let Promise.all observe either failure/abort.
  const [aid, keys] = await Promise.all([aidPromise, getKeys()]);
  const query = await signedQuery(
    {
      oid: video.cid,
      pid: aid,
      type: 1,
      context_ext: JSON.stringify({ video_type: 1 }),
      cur_production_type: 0,
      playlist_switch: 0,
      web_location: 1315873,
    },
    signal,
    keys,
  );
  const response = await fetch(
    "https://api.bilibili.com/x/v2/subtitle/web/view?" + query,
    { credentials: "include", signal, redirect: "error" },
  );
  if ([404, 405].includes(response.status)) return [];
  if (!response.ok)
    throw Error(
      "B站新字幕接口请求失败（" + response.status + "），请刷新后重试。",
    );
  if (Number(response.headers?.get("content-length") || 0) > 1024 * 1024)
    throw Error("B站字幕元数据过大。");
  try {
    return BiliSubtitles.decodeSubtitleTracks(await response.arrayBuffer());
  } catch {
    throw Error("B站新字幕接口返回了无法识别的数据，请刷新后重试。");
  }
}
function nativeRequest(
  type,
  input,
  { signal, onProgress, taskData, provider, model } = {},
) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    let connection,
      done = false;
    const timer = setTimeout(
      () =>
        finish(
          Error(
            type === "transcribe"
              ? "本机转写连接超时，请重试。"
              : "本机模型连接超时，请重试。",
          ),
        ),
      type === "transcribe"
        ? 32 * 60000
        : type === "status"
          ? 10000
          : type === "setup-local-model" || provider === "local"
            ? 40 * 60000
            : 6 * 60000,
    );
    const abort = () => finish(Error("任务已取消。"));
    function finish(error, value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      try {
        connection?.disconnect();
      } catch {}
      error ? reject(error) : resolve(value);
    }
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    try {
      connection = chrome.runtime.connectNative(HOST);
      connection.onMessage.addListener((message) => {
        if (message.id !== id) return;
        if (message.type === "progress") onProgress?.(message);
        else if (message.type === "result" || message.type === "status")
          finish(null, message);
        else if (message.type === "error") finish(Error(message.error));
      });
      connection.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError?.message;
        if (!done)
          finish(
            Error(
              error?.includes("not found")
                ? "尚未安装本机桥接，请运行“安装本机桥接.ps1”。"
                : "本机连接中断，请检查安装并重试。",
            ),
          );
      });
      connection.postMessage({ id, type, input, taskData, provider, model });
    } catch {
      finish(Error("无法启动本机桥接，请重新安装。"));
    }
  });
}
let storageQueue = Promise.resolve();
function mutateStorage(work) {
  const result = storageQueue.then(work);
  storageQueue = result.catch(() => {});
  return result;
}
async function record(kind, status, detail = {}) {
  await mutateStorage(async () => {
    const stored = await chrome.storage.local.get("diagnostics");
    const rows = Array.isArray(stored.diagnostics) ? stored.diagnostics : [];
    rows.push({ at: Date.now(), kind, status, ...detail });
    await chrome.storage.local.set({ diagnostics: rows.slice(-40) });
  }).catch(() => {});
}
async function cache(key, value, limit = 60) {
  try {
    await mutateStorage(async () => {
      const all = await chrome.storage.local.get(null),
        prefix = key.startsWith("transcript:") ? "transcript:" : "ai:";
      all[key] = value;
      const bytes = (name) =>
        new TextEncoder().encode(name + JSON.stringify(all[name])).length;
      const cached = Object.keys(all).filter((name) =>
        /^(summary:|ai:|transcript:)/.test(name),
      );
      let total = Object.keys(all).reduce((sum, name) => sum + bytes(name), 0),
        count = cached.filter((name) => name.startsWith(prefix)).length;
      const victims = cached
          .filter((name) => name !== key)
          .sort((a, b) =>
            (all[a].meta?.generatedAt || "").localeCompare(
              all[b].meta?.generatedAt || "",
            ),
          ),
        remove = [];
      for (const name of victims) {
        if (total <= 8 * 1024 * 1024 && count <= limit) break;
        if (
          count > limit &&
          total <= 8 * 1024 * 1024 &&
          !name.startsWith(prefix)
        )
          continue;
        total -= bytes(name);
        if (name.startsWith(prefix)) count--;
        remove.push(name);
      }
      if (remove.length) await chrome.storage.local.remove(remove);
      if (total <= 8 * 1024 * 1024)
        await chrome.storage.local.set({ [key]: value });
    });
  } catch {
    /* A successful model response remains usable when Chrome cannot cache it. */
  }
}
async function loadSubtitles(
  snapshot,
  pageUrl,
  signal,
  config,
  onProgress,
  force = false,
) {
  const { video, tracks } = await videoInfo(snapshot, pageUrl, signal);
  const key = "transcript:" + video.bvid + ":" + video.cid;
  const cached = (await chrome.storage.local.get(key))[key];
  let keysPromise;
  const getKeys = () => (keysPromise ||= signingKeys(signal));
  let track = BiliSubtitles.pickTrack(tracks);
  if (
    !force &&
    cached?.input?.subtitles?.length &&
    !(cached.input.source === "local-asr" && track) &&
    (cached.input.source !== "local-asr" ||
      cached.languagePreference === config.ai.asrLanguage)
  )
    return cached.input;
  if (!track)
    track = BiliSubtitles.pickTrack(
      await modernSubtitleTracks(video, signal, getKeys),
    );
  if (!track) {
    const query = await signedQuery(
      { bvid: video.bvid, cid: video.cid },
      signal,
      getKeys(),
    );
    const player = await getJSON(
      "https://api.bilibili.com/x/player/wbi/v2?" + query,
      signal,
    );
    if (player.code !== 0)
      throw Error(
        "B站拒绝了字幕请求（" +
          player.code +
          "），请先登录并打开播放器字幕，再重试。",
      );
    track = BiliSubtitles.pickTrack(player.data?.subtitle?.subtitles || []);
  }
  let input;
  if (track) {
    const data = await getJSON(
        BiliSubtitles.subtitleUrl(track.subtitle_url),
        signal,
      ),
      subtitles = BiliSubtitles.normalizeBody(data.body);
    if (!subtitles.length) throw Error("B站返回了空字幕。");
    input = {
      ...video,
      subtitles,
      language: String(track.lan_doc || track.lan || "字幕"),
      source: "official",
    };
  } else {
    if (!config.ai.asrFallback)
      throw Error("这个视频没有可读取的字幕。请在设置中开启本机转写。");
    onProgress?.({ stage: "audio-info" });
    const query = await signedQuery(
      {
        bvid: video.bvid,
        cid: video.cid,
        fnval: 4048,
        fnver: 0,
        qn: 16,
        fourk: 0,
      },
      signal,
      getKeys(),
    );
    const play = await getJSON(
      "https://api.bilibili.com/x/player/wbi/playurl?" + query,
      signal,
    );
    if (play.code !== 0)
      throw Error("当前账号无法取得可播放音轨（" + play.code + "）。");
    const audios = play.data?.dash?.audio || [];
    let audioUrl = "";
    for (const audio of [...audios].sort(
      (a, b) => (a.bandwidth || 0) - (b.bandwidth || 0),
    )) {
      for (const raw of [
        audio.baseUrl,
        audio.base_url,
        ...(audio.backupUrl || audio.backup_url || []),
      ]) {
        try {
          const url = new URL(String(raw).replace(/^http:/, "https:"));
          if (
            url.protocol === "https:" &&
            ["bilivideo.com", "bilivideo.cn"].some(
              (host) =>
                url.hostname === host || url.hostname.endsWith("." + host),
            )
          ) {
            audioUrl = url.href;
            break;
          }
        } catch {}
      }
      if (audioUrl) break;
    }
    if (!audioUrl)
      throw Error(
        "未找到可用于本机识别的独立音轨；需要当前账号可播放的普通视频。",
      );
    const response = await nativeRequest(
      "transcribe",
      { ...video, audioUrl, language: config.ai.asrLanguage },
      { signal, onProgress },
    );
    input = response.result;
  }
  if (JSON.stringify(input).length > 200000)
    throw Error("字幕超过 20 万字符，请先选择较短的分 P。");
  await cache(
    key,
    {
      input,
      languagePreference: config.ai.asrLanguage,
      meta: { generatedAt: new Date().toISOString() },
    },
    8,
  );
  return input;
}
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "bili-model-setup") {
    if (!ownPage(port.sender)) {
      port.disconnect();
      return;
    }
    let controller,
      current = "";
    const send = (message) => {
      try {
        port.postMessage(message);
      } catch {}
    };
    port.onDisconnect.addListener(() => controller?.abort());
    port.onMessage.addListener(async (message) => {
      if (message?.type === "cancel") {
        if (!message.id || message.id === current) controller?.abort();
        return;
      }
      if (
        message?.type !== "setup-local-model" ||
        controller ||
        typeof message.id !== "string" ||
        message.id.length > 80
      )
        return;
      const id = (current = message.id);
      controller = new AbortController();
      try {
        const ai = BiliConfig.normalize({
          ai: { localModel: message.model, provider: "local" },
        }).ai;
        const response = await nativeRequest("setup-local-model", undefined, {
          provider: "local",
          model: ai.localModel,
          signal: controller.signal,
          onProgress: (state) => send({ type: "progress", ...state, id }),
        });
        if (!controller.signal.aborted)
          send({ id, type: "result", result: response.result });
      } catch (error) {
        if (!controller.signal.aborted)
          send({ id, type: "error", error: error.message });
      } finally {
        controller = null;
      }
    });
    return;
  }
  if (port.name !== "bili-codex-panel") return;
  if (!validSender(port.sender)) {
    port.disconnect();
    return;
  }
  let controller = null,
    current = "",
    busy = false;
  const send = (message) => {
    try {
      port.postMessage(message);
    } catch {}
  };
  const close = () => {
    controller?.abort();
    busy = false;
  };
  port.onDisconnect.addListener(close);
  port.onMessage.addListener(async (message) => {
    if (message?.type === "cancel") {
      close();
      send({ type: "cancelled", id: current });
      return;
    }
    if (
      !["summarize", "chat", "ads", "polish", "subtitles"].includes(
        message?.type,
      ) ||
      busy ||
      typeof message.id !== "string" ||
      message.id.length > 80
    )
      return;
    const id = (current = message.id),
      kind = message.type === "summarize" ? "summary" : message.type;
    busy = true;
    controller = new AbortController();
    const activeController = controller,
      started = Date.now();
    const progress = (state) => send({ ...state, id, type: "progress" });
    try {
      const config = await settings();
      if (!config.ai.enabled) throw Error("AI 助手已关闭，请在设置中开启。");
      progress({ stage: "reading" });
      const input = await loadSubtitles(
        message.snapshot || {},
        port.sender.url,
        activeController.signal,
        config,
        progress,
        !!message.forceTranscript,
      );
      if (activeController.signal.aborted || current !== id) return;
      progress({
        stage: "connecting",
        subtitleCount: input.subtitles.length,
        language: input.language,
        source: input.source,
      });
      if (kind === "subtitles") {
        send({
          id,
          type: "result",
          result: input,
          meta: {
            kind,
            subtitleCount: input.subtitles.length,
            source: input.source,
            language: input.language,
          },
        });
        return;
      }
      const taskData = {
        prompt: kind === "summary" ? config.ai.summaryPrompt : "",
        question: message.question,
        history: Array.isArray(message.history)
          ? message.history.slice(-12)
          : [],
      };
      const digest = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(
              JSON.stringify({
                input,
                kind,
                taskData,
                provider: config.ai.provider,
                model:
                  config.ai.provider === "local"
                    ? config.ai.localModel
                    : undefined,
              }),
            ),
          ),
        ),
      )
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
      const key =
          "ai:" +
          kind +
          ":" +
          input.bvid +
          ":" +
          input.cid +
          ":" +
          (kind === "chat" ? digest.slice(0, 16) : "result"),
        cached = (await chrome.storage.local.get(key))[key];
      if (activeController.signal.aborted || current !== id) return;
      if (
        (kind !== "ads" || config.ai.adDetectionMode !== "always") &&
        (!message.force ||
          (kind === "ads" && config.ai.adDetectionMode === "cache")) &&
        cached?.digest === digest
      ) {
        send({
          id,
          type: "result",
          result: cached.result,
          meta: { ...cached.meta, cached: true },
        });
        return;
      }
      if (kind === "ads" && config.ai.adDetectionMode === "cache") {
        send({
          id,
          type: "result",
          result: { segments: [], cacheMiss: true },
          meta: { kind, subtitleCount: input.subtitles.length, cached: true },
        });
        return;
      }
      const response = await nativeRequest(message.type, input, {
        signal: activeController.signal,
        taskData,
        onProgress: progress,
        provider: config.ai.provider,
        model: config.ai.localModel,
      });
      const meta = {
        ...response.meta,
        kind,
        source: input.source,
        language: input.language,
      };
      await cache(key, { digest, result: response.result, meta });
      if (kind === "summary")
        await chrome.storage.local
          .set({
            lastSummary: {
              bvid: input.bvid,
              cid: input.cid,
              at: Date.now(),
              summaryCharacters: response.result.summary.length,
            },
          })
          .catch(() => {});
      await record(kind, "success", {
        bvid: input.bvid,
        elapsedMs: Date.now() - started,
        subtitleCount: input.subtitles.length,
      });
      send({ id, type: "result", result: response.result, meta });
    } catch (error) {
      if (!activeController.signal.aborted && current === id) {
        await record(kind, "error", {
          error: error.message,
          elapsedMs: Date.now() - started,
        });
        send({
          id,
          type: "error",
          error: error.message || "处理失败，请刷新页面重试。",
        });
      }
    } finally {
      if (current === id) busy = false;
    }
  });
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (
    message?.type === "open-settings" &&
    (biliSender(sender) || ownPage(sender))
  ) {
    chrome.runtime
      .openOptionsPage()
      .then(() => respond({ ok: true }))
      .catch(() => respond({ ok: false }));
    return true;
  }
  if (message?.type === "check" && ownPage(sender)) {
    settings()
      .then((config) => {
        const ai = BiliConfig.normalize({
          ai: {
            provider: message.provider || config.ai.provider,
            localModel: message.model || config.ai.localModel,
          },
        }).ai;
        return nativeRequest("status", undefined, {
          provider: ai.provider,
          model: ai.localModel,
        });
      })
      .then((result) =>
        respond({
          ok: true,
          version: result.version,
          asrReady: result.asrReady,
          capabilities: result.capabilities,
          provider: result.provider,
          localRuntimeReady: result.localRuntimeReady,
          localModelReady: result.localModelReady,
          localModel: result.localModel,
          codexInstalled: result.codexInstalled,
        }),
      )
      .catch((error) => respond({ ok: false, error: error.message }));
    return true;
  }
  if (
    message?.type === "bili-api" &&
    biliSender(sender) &&
    /^BV[0-9A-Za-z]{10}$/.test(message.bvid || "") &&
    ["view", "videoshot"].includes(message.task)
  ) {
    const path =
      message.task === "view" ? "/x/web-interface/view" : "/x/player/videoshot";
    getJSON(
      "https://api.bilibili.com" +
        path +
        "?bvid=" +
        message.bvid +
        (message.task === "videoshot" ? "&index=1" : ""),
      AbortSignal.timeout(15000),
    )
      .then((data) => {
        if (data.code !== 0) throw Error("B站没有返回预览信息。");
        respond({ ok: true, data: data.data });
      })
      .catch((error) => respond({ ok: false, error: error.message }));
    return true;
  }
  if (
    message?.type === "saved-seconds" &&
    validSender(sender) &&
    Number.isFinite(message.seconds) &&
    message.seconds > 0 &&
    message.seconds < 7200
  ) {
    mutateStorage(async () => {
      const stored = await chrome.storage.local.get("biliStats"),
        stats = stored.biliStats || {};
      stats.skippedSeconds =
        (Number(stats.skippedSeconds) || 0) + message.seconds;
      stats.skippedSegments = (Number(stats.skippedSegments) || 0) + 1;
      await chrome.storage.local.set({ biliStats: stats });
      respond({ ok: true });
    });
    return true;
  }
});
