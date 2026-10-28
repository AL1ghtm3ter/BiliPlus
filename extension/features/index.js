(() => {
  "use strict";
  const F = BiliFeatures;
  let settings = BiliConfig.normalize(),
    stops = [],
    fingerprint = "",
    configHash = "",
    patchTimer;
  const commentAuthors = new Map();
  let commentOid = "";
  function clearComments() {
    context.comments.clear();
    commentAuthors.clear();
    commentOid = "";
    Object.assign(context.commentIpDiagnostics, {
      records: 0,
      painted: 0,
      recoveries: 0,
      error: "",
    });
  }
  const context = {
    videos: new Map(),
    comments: new Map(),
    commentIpDiagnostics: { records: 0, painted: 0, recoveries: 0, error: "" },
    details: new Map(),
    history: { count: 0, index: 0 },
    aiMount: null,
    currentVideoKey: "",
    settings: () => settings,
    patch: (key, value) => {
      if (
        JSON.stringify(BiliConfig.get(settings, key)) === JSON.stringify(value)
      )
        return;
      BiliConfig.set(settings, key, value);
      configHash = JSON.stringify(settings);
      if (key.startsWith("appearance.")) applyAppearance();
      else if (key !== "player.speed") restart();
      clearTimeout(patchTimer);
      patchTimer = setTimeout(
        () =>
          chrome.storage.local.set({ biliSettings: settings }).catch(() => {}),
        600,
      );
    },
  };
  F.context = context;
  function applyAppearance() {
    for (const node of document.querySelectorAll("[data-bcx-widget]"))
      node.setAttribute("data-theme", BiliConfig.theme(settings));
    window.dispatchEvent(new CustomEvent("bili-codex-settings-change"));
  }
  function behavior(value) {
    const { appearance, ...rest } = value;
    return JSON.stringify(rest);
  }
  function restart() {
    for (const stop of stops.reverse())
      try {
        stop();
      } catch {}
    stops = [];
    if (!settings.player.commentIp) clearComments();
    for (const module of F.modules)
      try {
        stops.push(module.start(settings, context));
      } catch {}
    window.dispatchEvent(new CustomEvent("bili-codex-settings-change"));
    window.dispatchEvent(
      new CustomEvent("bili-codex-config", {
        detail: JSON.stringify({
          history: settings.home.history,
          historyLimit: settings.home.historyLimit,
          commentIp: settings.player.commentIp,
          videoMetadata:
            settings.filter.enabled ||
            settings.filter.ads ||
            settings.filter.promoted ||
            settings.filter.labels ||
            settings.home.history ||
            settings.home.preview,
        }),
      }),
    );
  }
  window.addEventListener("bili-codex-data", (event) => {
    try {
      if (typeof event.detail !== "string" || event.detail.length > 2e6) return;
      const data = JSON.parse(event.detail);
      if (settings.player.commentIp && data.commentIpDiagnostics) {
        const report = data.commentIpDiagnostics;
        context.commentIpDiagnostics.recoveries = Math.max(
          0,
          Math.min(10000, Number(report.recoveries) || 0),
        );
        context.commentIpDiagnostics.error =
          /^(?:HTTP_\d{3}|API_-?\d+|RESPONSE_TOO_LARGE|AbortError|SyntaxError|TypeError|Error)$/.test(
            report.error || "",
          )
            ? report.error
            : "";
      }
      if (
        BiliConfig.isPlaybackLocation(location) &&
        data.player &&
        /^\d+$/.test(String(data.player.cid || ""))
      )
        context.currentVideoKey =
          (data.player.bvid || data.player.aid || "") + ":" + data.player.cid;
      if (Array.isArray(data.videos))
        for (const item of data.videos.slice(0, 200)) {
          if (item && (item.bvid || item.uri))
            context.videos.set(item.bvid || item.uri, item);
        }
      while (context.videos.size > 600)
        context.videos.delete(context.videos.keys().next().value);
      if (
        settings.player.commentIp &&
        Array.isArray(data.comments) &&
        (!data.commentPage ||
          data.commentPage ===
            location.pathname +
              (location.pathname.startsWith("/list/")
                ? location.search || ""
                : ""))
      ) {
        if (
          data.commentOid &&
          commentOid &&
          String(data.commentOid) !== commentOid
        )
          clearComments();
        if (data.commentOid) commentOid = String(data.commentOid);
        for (const item of data.comments.slice(0, 1000)) {
          if (typeof item.location !== "string") continue;
          const value = item.location.trim().slice(0, 80),
            rpid = String(item.rpid || ""),
            uid = String(item.uid || "");
          if (!value) continue;
          if (/^\d+$/.test(rpid)) context.comments.set(rpid, value);
          if (/^\d+$/.test(uid)) {
            const previous = commentAuthors.get(uid);
            if (previous === undefined || previous === value) {
              commentAuthors.set(uid, value);
              context.comments.set("uid:" + uid, value);
            } else {
              // A person can post from multiple locations. UID is only a
              // fallback when every observed public reply agrees.
              commentAuthors.set(uid, null);
              context.comments.delete("uid:" + uid);
            }
          }
        }
        while (commentAuthors.size > 2000) {
          const uid = commentAuthors.keys().next().value;
          commentAuthors.delete(uid);
          context.comments.delete("uid:" + uid);
        }
        while (context.comments.size > 3000)
          context.comments.delete(context.comments.keys().next().value);
        context.commentIpDiagnostics.records = [
          ...context.comments.keys(),
        ].filter((key) => /^\d+$/.test(key)).length;
        window.dispatchEvent(new CustomEvent("bili-codex-comments-change"));
      }
      if (data.history) context.history = data.history;
    } catch {}
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (!changes.biliSettings) {
      if (changes.localBackground) restart();
      return;
    }
    try {
      const next = BiliConfig.normalize(changes.biliSettings.newValue);
      const hash = JSON.stringify(next);
      if (hash === configHash) {
        if (changes.localBackground) restart();
        return;
      }
      const appearanceOnly = behavior(settings) === behavior(next);
      if (appearanceOnly) settings.appearance = next.appearance;
      else settings = next;
      configHash = hash;
      if (appearanceOnly) applyAppearance();
      else restart();
    } catch {}
  });
  (async () => {
    const data = await chrome.storage.local.get("biliSettings");
    settings = BiliConfig.normalize(data.biliSettings);
    configHash = JSON.stringify(settings);
    fingerprint = location.pathname + location.search + context.currentVideoKey;
    restart();
    setInterval(() => {
      const next =
        location.pathname + location.search + context.currentVideoKey;
      if (next !== fingerprint) {
        fingerprint = next;
        context.history = { count: 0, index: 0 };
        clearComments();
        restart();
      }
    }, 1000);
  })();
})();
