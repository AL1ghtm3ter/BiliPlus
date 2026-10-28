(() => {
  "use strict";
  if (window !== top || document.getElementById("bili-codex-root")) return;
  const host = document.createElement("div");
  host.id = "bili-codex-root";
  host.style.setProperty("margin-bottom", "16px", "important");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<link rel="stylesheet" href="${chrome.runtime.getURL("panel.css")}">
<button class="launcher" type="button" hidden>AI 助手</button>
<aside id="panel" aria-label="AI助手"><header>
  <div class="brand"><img src="${chrome.runtime.getURL("common/brand.svg")}" alt="" width="34" height="34"><h2>AI助手</h2></div>
  <div class="header-tools"><span class="connection-state" role="status">已就绪</span><button class="collapse" type="button" aria-expanded="true" aria-label="收起视频助手" title="收起"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 14 5-5 5 5"/></svg></button></div>
</header><div class="assistant-main">
<nav class="side-rail" aria-label="助手功能"><div class="tabs" role="tablist" aria-orientation="vertical">
  <button type="button" data-tab="subtitles" role="tab" aria-selected="true" aria-label="字幕" title="字幕"><span class="nav-glyph">字</span></button>
  <button type="button" data-tab="summary" role="tab" aria-selected="false" aria-label="总结" title="总结"><span class="nav-glyph">总</span></button>
  <button type="button" data-tab="chat" role="tab" aria-selected="false" aria-label="提问" title="提问"><span class="nav-glyph">问</span></button>
  <button type="button" data-tab="ads" role="tab" aria-selected="false" aria-label="广告识别" title="广告识别"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="6" width="16" height="12" rx="3"/><path d="m10 10 5 2-5 2z"/></svg></button>
</div><div class="rail-bottom">
  <button class="copy" type="button" disabled aria-label="复制当前内容" title="复制当前内容"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="7" width="12" height="14" rx="2"/><path d="M16 3H5a2 2 0 0 0-2 2v12"/></svg></button>
  <button class="settings" type="button" aria-label="设置" title="设置"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><circle cx="12" cy="12" r="3"/></svg></button>
</div></nav>
<div class="body"><div class="pane-heading"><h3 class="pane-title">字幕</h3><span class="pane-badge">等待读取</span></div>
<p class="video-title" hidden></p><div class="state-row"><p class="status" role="status" aria-live="polite" hidden>准备就绪</p><button class="cancel" type="button" hidden>取消</button></div><p class="error" role="alert" hidden></p>
<div data-pane="summary" class="summary-pane" data-empty="true" hidden>
 <div class="intro"><h4>视频总结</h4><p>生成视频总结和分段总结，分段可直接跳转到时间点。</p></div>
 <div class="actions"><button class="start primary" type="button">开始总结</button></div>
 <div class="result" hidden><section class="overview"><h3>视频概要</h3><div class="summary"></div><h3>重点</h3><ul class="points"></ul></section><div class="summary-resizer" role="separator" tabindex="0" aria-label="调整概要与分段高度" aria-orientation="horizontal" aria-valuemin="30" aria-valuemax="80" aria-valuenow="62"></div><section class="chapters"><div class="section-heading"><h3>视频分段</h3><span>已完成</span></div><ol class="segments"></ol></section></div>
</div>
<div data-pane="subtitles" class="subtitle-pane"><div class="subtitle-placeholder"><h4>视频字幕</h4><p>读取视频字幕，支持复制、导出和整理成文。无字幕时使用本机识别。</p></div><div class="subtitle-toolbar"><div class="actions"><button class="read primary" type="button">读取字幕</button><button class="polish" type="button">整理成文</button></div><div class="export-actions" hidden><select class="export-format" aria-label="导出字幕"><option value="">导出</option><option value="srt">SRT</option><option value="txt">TXT</option><option value="json">JSON</option></select><button class="follow-subtitle" type="button" hidden title="恢复字幕随播放定位">跟随播放</button></div></div><p class="transcript-meta"></p><div class="transcript"></div><section class="article-area" hidden><h3>润色文章</h3><button class="copy-article" type="button">复制文章</button><div class="article"></div></section></div>
<div data-pane="chat" class="chat-pane" hidden><p class="hint">围绕视频内容提问，回答会引用字幕时间。</p><div class="chat-log" role="log" aria-live="polite"></div><form class="question-form"><label for="question">你的问题</label><textarea id="question" maxlength="6000" rows="3" placeholder="输入你想了解的问题…"></textarea><button class="ask primary" type="submit">发送</button></form></div>
<div data-pane="ads" hidden><h4>广告识别</h4><p class="hint">识别视频中的口播推广与植入广告。可查看依据、跳转或保留片段。</p><button class="detect primary" type="button">识别广告</button><div class="ads-result"></div></div>
<p class="footnote"><span class="engine-note">本地模型分析</span> · <span class="source-note">优先使用已有字幕</span></p>
</div></div><div class="panel-resizer" role="separator" tabindex="0" aria-label="调整助手高度" aria-orientation="horizontal" aria-valuemin="360" aria-valuemax="1600" aria-valuenow="600" title="上下拖动调整高度；方向键微调，双击恢复默认"><span></span></div></aside>`;
  const $ = (s) => shadow.querySelector(s),
    all = (s) => [...shadow.querySelectorAll(s)],
    panel = $("#panel"),
    launcher = $(".launcher");
  const config = () =>
    globalThis.BiliFeatures?.context?.settings?.() ||
    globalThis.BiliConfig?.normalize?.() || {
      ai: { enabled: true, skipAds: false },
    };
  let port = null,
    requestId = "",
    busy = false,
    timer = null,
    stage = "",
    startedAt = 0,
    result = null,
    transcript = null,
    article = "",
    history = [],
    videoKey = "",
    activeKind = "summary",
    ads = [],
    kept = new Set(),
    skipped = new Set(),
    adWidget = null,
    adPending = null,
    autoAdsDone = false,
    autoSummaryDone = false,
    autoAsrDone = false,
    video = null,
    videoListener = null,
    subtitleRows = [],
    subtitleCues = [],
    activeSubtitle = -1,
    subtitleScrollUntil = 0,
    pageLoaded = !document.readyState || document.readyState === "complete",
    mountStarted = Date.now(),
    selectedTab = "subtitles",
    healthProbe = 0,
    manualHeight = 0,
    heightGesture = null;
  const taskStates = new Map(),
    taskPane = (kind) => (kind === "polish" ? "subtitles" : kind);
  const subtitleVideoEvents = [
    "timeupdate",
    "seeking",
    "seeked",
    "loadedmetadata",
  ];
  const key = () =>
      location.pathname +
      location.search +
      (globalThis.BiliFeatures?.context?.currentVideoKey || ""),
    stamp = (s) => {
      const n = Math.max(0, Math.floor(s));
      return (
        (n >= 3600 ? Math.floor(n / 3600) + ":" : "") +
        String(Math.floor(n / 60) % 60).padStart(2, "0") +
        ":" +
        String(n % 60).padStart(2, "0")
      );
    };
  const create = (tag, text, attributes = {}) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    for (const [k, v] of Object.entries(attributes)) node.setAttribute(k, v);
    return node;
  };
  const title = () =>
    document.querySelector("h1")?.textContent?.trim() ||
    document.title.replace(/_哔哩哔哩_bilibili$/, "");
  function tab(name) {
    selectedTab = name;
    for (const button of all("[data-tab]"))
      button.setAttribute("aria-selected", String(button.dataset.tab === name));
    for (const pane of all("[data-pane]"))
      pane.hidden = pane.dataset.pane !== name;
    $(".pane-title").textContent =
      { subtitles: "字幕", summary: "总结", chat: "提问", ads: "广告识别" }[
        name
      ] || "AI助手";
    renderTaskState();
    if (name === "subtitles") syncSubtitle(true);
  }
  function renderTaskState() {
    const state = taskStates.get(selectedTab);
    $(".status").textContent = state?.text || "";
    $(".status").hidden =
      !state?.text ||
      (selectedTab === "subtitles" &&
        !!transcript &&
        !(busy && taskPane(activeKind) === "subtitles"));
    $(".copy").disabled =
      !copyContent() || (busy && taskPane(activeKind) === selectedTab);
    $(".error").textContent = state?.error || "";
    $(".error").hidden = !state?.error;
    updateBadge();
  }
  function updateBadge() {
    $(".engine-note").textContent =
      config().ai.provider === "codex" ? "Codex 分析" : "本地模型分析";
    $(".connection-state").textContent = busy ? "处理中" : "已就绪";
    $(".pane-badge").textContent =
      busy && selectedTab === taskPane(activeKind)
        ? "正在处理"
        : !$(".error").hidden
          ? "处理失败"
          : selectedTab === "summary"
            ? result
              ? "AI 生成完成"
              : "AI 生成总结"
            : selectedTab === "subtitles"
              ? transcript
                ? "字幕已就绪"
                : "等待读取"
              : selectedTab === "chat"
                ? "视频问答"
                : "广告片段";
  }
  function placement() {
    const dock = globalThis.BiliFeatures?.context?.aiMount;
    if (dock?.isConnected) return { target: dock, docked: true };
    if (document.querySelector(".bpx-player-ctrl-wide.bpx-state-entered")) {
      const anchor = document.querySelector("#danmukuBox");
      return anchor?.parentElement
        ? { target: anchor.parentElement, anchor }
        : null;
    }
    const target =
      document.querySelector(".right-container-inner.scroll-sticky") ||
      document.querySelector(".right-container-inner") ||
      document.querySelector(".right-container") ||
      document.querySelector(".playlist-container--right");
    if (!target) return null;
    const comment = target.querySelector("#commentapp");
    const anchor =
      comment?.parentElement === target
        ? comment
        : target.querySelector(".up-panel-container");
    return { target, anchor };
  }
  function sizePanel() {
    if (!host.isConnected || host.hasAttribute("data-collapsed")) return;
    // A fixed reader frame must not grow with video-page wrappers or subtitles.
    const height =
        manualHeight ||
        Math.round(
          Math.max(360, Math.min(600, (window.innerHeight || 900) - 160)),
        ),
      value = height + "px";
    if (host.style.getPropertyValue("--bcx-panel-height") !== value)
      host.style.setProperty("--bcx-panel-height", value);
    if ($(".panel-resizer").getAttribute("aria-valuenow") !== String(height))
      $(".panel-resizer").setAttribute("aria-valuenow", String(height));
  }
  function pageHealth() {
    // Four bounded local samples make page-loading failures inspectable without
    // reading comments, image addresses, cookies, or page error messages.
    if (healthProbe >= 4) return;
    if (Date.now() - mountStarted < [5000, 15000, 30000, 60000][healthProbe])
      return;
    healthProbe++;
    const images = [...document.querySelectorAll("img")],
      comment = document.querySelector("#commentapp,.comment-container"),
      comments =
        comment?.querySelector("bili-comments") ||
        document.querySelector("bili-comments");
    const data = {
      version: chrome.runtime.getManifest?.().version || "unknown",
      at: Date.now(),
      sample: healthProbe,
      readyState: document.readyState,
      images: {
        total: images.length,
        loaded: images.filter((i) => i.naturalWidth > 0).length,
        failed: images.filter((i) => i.complete && !i.naturalWidth).length,
      },
      comments: {
        container: !!comment,
        component: !!comments,
        shadowChildren: comments?.shadowRoot?.childElementCount ?? null,
      },
      panel: {
        connected: host.isConnected,
        parent: host.parentElement?.className || "",
        embedded: host.parentElement !== document.documentElement,
      },
    };
    const ip = globalThis.BiliFeatures?.context?.commentIpDiagnostics;
    if (ip)
      data.commentIp = {
        records: Number(ip.records) || 0,
        painted: Number(ip.painted) || 0,
        recoveries: Number(ip.recoveries) || 0,
        error: String(ip.error || "").slice(0, 100),
      };
    chrome.storage?.local?.set({ pageHealth: data }).catch(() => {});
  }
  function mount() {
    if (
      !(
        globalThis.BiliConfig?.isPlaybackLocation(location) ??
        /\/video\/BV[0-9A-Za-z]{10}/.test(location.pathname)
      ) ||
      !config().ai.enabled
    ) {
      stop();
      clearAd();
      unwatchVideo();
      clearSubtitleSync();
      ads = [];
      removeMarkers();
      host.remove();
      videoKey = "";
      return;
    }
    // Let B站 finish its own initialization before inserting into its sidebar.
    // Native comments and recommendation nodes stay owned by the page.
    if (!pageLoaded) return;
    pageHealth();
    const commentRoot = document.querySelector("#commentapp");
    if (
      commentRoot &&
      !commentRoot.querySelector("bili-comments") &&
      Date.now() - mountStarted < 8000 &&
      document.readyState
    )
      return;
    const slot = placement();
    if (!slot) {
      host.remove();
      return;
    }
    if (globalThis.BiliConfig) {
      const theme = BiliConfig.theme(config());
      if (host.getAttribute("data-theme") !== theme)
        host.setAttribute("data-theme", theme);
    }
    if (slot.docked) {
      if (host.parentNode !== slot.target) slot.target.append(host);
      if (!host.hasAttribute("data-docked"))
        host.setAttribute("data-docked", "true");
    } else {
      if (slot.anchor?.parentElement === slot.target) {
        if (host.previousElementSibling !== slot.anchor)
          slot.anchor.after(host);
      } else if (slot.target.firstElementChild !== host)
        slot.target.prepend(host);
      if (host.hasAttribute("data-docked")) host.removeAttribute("data-docked");
    }
    sizePanel();
    if (videoKey !== key()) reset();
    watchVideo();
    markers();
  }
  function reset() {
    stop();
    clearAd();
    taskStates.clear();
    healthProbe = 0;
    mountStarted = Date.now();
    videoKey = key();
    $(".video-title").textContent = title();
    $(".result").hidden = true;
    $(".error").hidden = true;
    $(".copy").hidden = false;
    $(".copy").disabled = true;
    $(".intro").hidden = false;
    $(".start").textContent = "开始总结";
    $(".status").textContent = "准备就绪";
    $(".status").hidden = true;
    $('[data-pane="summary"]').setAttribute("data-empty", "true");
    $(".subtitle-placeholder").hidden = false;
    $(".chat-log").replaceChildren();
    clearSubtitleSync();
    $(".transcript").replaceChildren();
    $(".transcript").scrollTop = 0;
    $(".transcript-meta").textContent = "";
    $(".export-actions").hidden = true;
    $(".subtitle-pane").removeAttribute("data-ready");
    $(".article-area").hidden = true;
    $(".ads-result").replaceChildren();
    $(".source-note").textContent = "优先使用已有字幕";
    result = null;
    transcript = null;
    $(".read").textContent = "读取字幕";
    $(".read").removeAttribute("aria-label");
    article = "";
    history = [];
    ads = [];
    kept = new Set();
    skipped = new Set();
    autoAdsDone = false;
    autoSummaryDone = false;
    autoAsrDone = false;
    removeMarkers();
    tab("subtitles");
  }
  function status(text) {
    stage = text;
    taskStates.set(busy ? taskPane(activeKind) : selectedTab, {
      text:
        text +
        (busy
          ? " · " + Math.floor((Date.now() - startedAt) / 1000) + " 秒"
          : ""),
    });
    renderTaskState();
  }
  function stop() {
    busy = false;
    clearInterval(timer);
    timer = null;
    for (const button of all(".start,.ask,.read,.polish,.detect"))
      button.disabled = false;
    $(".cancel").hidden = true;
    panel.removeAttribute("aria-busy");
    updateBadge();
    if (port) {
      port.disconnect();
      port = null;
    }
  }
  function fail(message) {
    stop();
    taskStates.set(taskPane(activeKind), { text: "未完成", error: message });
    renderTaskState();
    if (activeKind === "summary") $(".start").textContent = "重试总结";
  }
  function snapshot() {
    return new Promise((resolve) => {
      const id = crypto.randomUUID();
      const receive = (event) => {
        try {
          const data = JSON.parse(event.detail);
          if (data.id !== id) return;
          cleanup();
          resolve(data);
        } catch {}
      };
      const cleanup = () => {
        clearTimeout(timeout);
        window.removeEventListener("bili-codex-snapshot", receive);
      };
      const timeout = setTimeout(() => {
        cleanup();
        resolve({});
      }, 1200);
      window.addEventListener("bili-codex-snapshot", receive);
      window.dispatchEvent(
        new CustomEvent("bili-codex-request", {
          detail: JSON.stringify({ id }),
        }),
      );
    });
  }
  function seek(time) {
    const player = document.querySelector("video");
    if (!player) {
      status("未找到播放器，请退出小窗模式后重试。");
      return;
    }
    player.currentTime = time;
    syncSubtitle();
  }
  function paragraphs(target, text) {
    target.replaceChildren(
      ...String(text)
        .split(/\n\s*\n/)
        .map((text) => create("p", text)),
    );
  }
  function showSummary(data) {
    result = data;
    removeMarkers();
    $(".intro").hidden = true;
    $(".result").hidden = false;
    $(".copy").hidden = false;
    $(".copy").disabled = false;
    $('[data-pane="summary"]').setAttribute("data-empty", "false");
    $(".start").textContent = "重新生成";
    paragraphs($(".summary"), data.summary);
    $(".points").replaceChildren(
      ...data.keyPoints.map((text) => create("li", text)),
    );
    $(".segments").replaceChildren(
      ...data.segments.map((segment) => {
        const li = create("li"),
          button = create("button", undefined, {
            type: "button",
            class: "seek",
          }),
          time = create("span", stamp(segment.start), { class: "time" });
        button.append(time, create("span", segment.title));
        button.addEventListener("click", () => seek(segment.start));
        li.append(button, create("p", segment.summary));
        return li;
      }),
    );
    markers();
    updateBadge();
  }
  function chatMessage(role, text, references = []) {
    const block = create("div", undefined, { class: "chat-message " + role });
    block.append(create("strong", role === "user" ? "你" : "Codex"));
    const body = create("div");
    paragraphs(body, text);
    block.append(body);
    for (const ref of references) {
      const button = create("button", stamp(ref.start) + " " + ref.label, {
        type: "button",
        class: "reference",
      });
      button.addEventListener("click", () => seek(ref.start));
      block.append(button);
    }
    $(".chat-log").append(block);
    const log = $(".chat-log");
    log.scrollTop = log.scrollHeight;
  }
  function showTranscript(data) {
    clearSubtitleSync();
    transcript = data;
    $(".subtitle-placeholder").hidden = true;
    $(".copy").disabled = false;
    updateBadge();
    $(".read").textContent = "重新读取字幕";
    $(".subtitle-pane").setAttribute("data-ready", "true");
    $(".export-actions").hidden = false;
    $(".transcript-meta").title =
      data.subtitles.length +
      " 条 · " +
      (data.source === "local-asr"
        ? "本机识别（" + data.language + "）"
        : "已有字幕（" + data.language + "）");
    $(".transcript-meta").textContent =
      data.subtitles.length +
      " 条 · " +
      (data.source === "local-asr" ? "本机识别" : "已有字幕");
    subtitleRows = data.subtitles.map((s, index) => {
      const row = create("button", undefined, {
        class: "subtitle-line",
        type: "button",
        "data-subtitle-index": index,
        "aria-label": "跳转到 " + stamp(s.start) + " " + s.text,
      });
      row.append(
        create("span", stamp(s.start), { class: "subtitle-time" }),
        create("span", s.text),
      );
      return row;
    });
    let maxEnd = -Infinity;
    subtitleCues = data.subtitles
      .map((s, index) => ({ start: s.start, end: s.end, index }))
      .sort((a, b) => a.start - b.start || a.index - b.index)
      .map((cue) => ({ ...cue, maxEnd: (maxEnd = Math.max(maxEnd, cue.end)) }));
    $(".transcript").replaceChildren(...subtitleRows);
    $(".transcript").scrollTop = 0;
    syncSubtitle(true);
  }
  function setActiveSubtitle(index) {
    if (index === activeSubtitle) return;
    subtitleRows[activeSubtitle]?.removeAttribute("aria-current");
    activeSubtitle = index;
    subtitleRows[index]?.setAttribute("aria-current", "true");
  }
  function clearSubtitleSync() {
    setActiveSubtitle(-1);
    subtitleRows = [];
    subtitleCues = [];
    subtitleScrollUntil = 0;
    $(".follow-subtitle").hidden = true;
  }
  function syncSubtitle(force = false) {
    if (
      !transcript ||
      !subtitleCues.length ||
      !config().ai.enabled ||
      videoKey !== key()
    )
      return;
    if (!video || video !== document.querySelector("video")) return;
    const time = video.currentTime;
    if (!Number.isFinite(time)) return;
    let low = 0,
      high = subtitleCues.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (subtitleCues[mid].start <= time) low = mid + 1;
      else high = mid;
    }
    let index = -1;
    for (let i = low - 1; i >= 0 && subtitleCues[i].maxEnd > time; i--) {
      if (subtitleCues[i].end > time) {
        index = subtitleCues[i].index;
        break;
      }
    }
    setActiveSubtitle(index);
    const suspended = Date.now() < subtitleScrollUntil;
    $(".follow-subtitle").hidden = !suspended;
    if (
      index < 0 ||
      selectedTab !== "subtitles" ||
      host.hasAttribute("data-collapsed") ||
      (suspended && !force)
    )
      return;
    const list = $(".transcript"),
      row = subtitleRows[index],
      height = list.clientHeight;
    if (
      !(height > 0) ||
      !row?.getBoundingClientRect ||
      !list.getBoundingClientRect
    )
      return;
    const box = list.getBoundingClientRect(),
      rect = row.getBoundingClientRect();
    if (!(rect.height > 0)) return;
    const top = box.top + (list.clientTop || 0);
    if (force || rect.top < top || rect.bottom > top + height)
      list.scrollTop = Math.max(
        0,
        Math.min(
          list.scrollHeight - height,
          list.scrollTop + rect.top - top - (height - rect.height) / 2,
        ),
      );
  }
  function pauseSubtitleFollow() {
    if (!transcript) return;
    subtitleScrollUntil = Date.now() + 5000;
    $(".follow-subtitle").hidden = false;
  }
  function showAds(data) {
    ads = data.segments;
    removeMarkers();
    $(".ads-result").replaceChildren();
    if (!ads.length) {
      $(".ads-result").append(
        create(
          "p",
          data.cacheMiss
            ? "本机没有这段视频的广告缓存，本次未调用 Codex。"
            : "没有识别到明确广告片段。",
          { class: "hint" },
        ),
      );
      return;
    }
    for (const segment of ads) {
      const row = create("section", undefined, { class: "ad-segment" });
      row.append(
        create(
          "h3",
          stamp(segment.start) + "–" + stamp(segment.end) + " " + segment.label,
        ),
        create("p", segment.reason),
        create(
          "p",
          "置信度 " +
            Math.round(segment.confidence * 100) +
            "%" +
            (segment.confidence < config().ai.adThreshold
              ? " · 仅供参考，不会自动跳过"
              : ""),
          { class: "hint" },
        ),
      );
      const jump = create("button", "跳过这段", { type: "button" }),
        keep = create("button", "保留这段", { type: "button" });
      jump.addEventListener("click", () => skipAd(segment));
      keep.addEventListener("click", () => {
        kept.add(adId(segment));
        keep.textContent = "本次保留";
        clearAd();
      });
      row.append(jump, keep);
      $(".ads-result").append(row);
    }
    markers();
  }
  async function start(type = "summarize", extra = {}, foreground = true) {
    if (busy) return;
    activeKind = type === "summarize" ? "summary" : type;
    const requestedKind = activeKind;
    taskStates.delete(taskPane(activeKind));
    if (foreground) tab(activeKind === "polish" ? "subtitles" : activeKind);
    if (type === "summarize") autoSummaryDone = true;
    if (type === "ads") autoAdsDone = true;
    if (type === "subtitles") autoAsrDone = true;
    $(".error").hidden = true;
    busy = true;
    startedAt = Date.now();
    requestId = crypto.randomUUID();
    const id = requestId;
    const requestVideoKey = key();
    for (const button of all(".start,.ask,.read,.polish,.detect"))
      button.disabled = true;
    $(".cancel").hidden = false;
    panel.setAttribute("aria-busy", "true");
    status("读取字幕");
    timer = setInterval(() => status(stage), 1000);
    try {
      const data = await snapshot();
      if (!busy || requestId !== id || key() !== requestVideoKey) return;
      port = chrome.runtime.connect({ name: "bili-codex-panel" });
      const connection = port;
      let completed = false;
      port.onMessage.addListener((message) => {
        if (
          completed ||
          !busy ||
          requestId !== id ||
          port !== connection ||
          key() !== requestVideoKey
        )
          return;
        if (message.id && message.id !== id) return;
        if (message.type === "progress") {
          const names = {
            reading: "读取字幕",
            connecting:
              config().ai.provider === "codex"
                ? "连接本机 Codex"
                : "连接本地模型",
            generating:
              config().ai.provider === "codex"
                ? "Codex 正在生成"
                : "本地模型正在生成",
            "audio-info": "获取音轨",
            downloading: "下载可播放音轨",
            transcribing: "本机识别语音",
          };
          status(
            (typeof message.status === "string"
              ? message.status.slice(0, 200)
              : names[message.stage] || "处理中") +
              (Number.isFinite(message.percent)
                ? " · " + Math.round(message.percent) + "%"
                : "") +
              (message.subtitleCount
                ? " · " + message.subtitleCount + " 条字幕"
                : "") +
              (message.seconds ? " · 已识别至 " + stamp(message.seconds) : ""),
          );
          if (message.source)
            $(".source-note").textContent =
              message.source === "local-asr"
                ? "本次使用本机识别字幕。"
                : "本次使用已有字幕。";
        }
        if (message.type === "result") {
          completed = true;
          stop();
          const reportedKind =
            message.meta?.kind === "summarize" ? "summary" : message.meta?.kind;
          const kind = [
            "summary",
            "chat",
            "subtitles",
            "polish",
            "ads",
          ].includes(reportedKind)
            ? reportedKind
            : requestedKind;
          if (kind === "summary") showSummary(message.result);
          if (kind === "chat") {
            history.push({ role: "assistant", content: message.result.answer });
            chatMessage(
              "assistant",
              message.result.answer,
              message.result.references,
            );
            $("#question").value = "";
          }
          if (kind === "subtitles") showTranscript(message.result);
          if (kind === "polish") {
            article = message.result.article;
            $(".article-area").hidden = false;
            paragraphs($(".article"), article);
          }
          if (kind === "ads") showAds(message.result);
          const completion =
            (message.meta?.cached ? "已读取本机缓存" : "处理完成") +
            " · " +
            (message.meta?.subtitleCount || "") +
            " 条字幕" +
            (message.meta?.elapsedMs
              ? " · " + Math.round(message.meta.elapsedMs / 1000) + " 秒"
              : "");
          taskStates.set(taskPane(kind), { text: completion });
          renderTaskState();
        }
        if (message.type === "error") {
          completed = true;
          fail(message.error);
        }
      });
      port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError?.message;
        if (!completed && busy && port === connection)
          fail(
            error
              ? "扩展连接失效，请刷新视频页后重试。"
              : "本机连接已断开，请重试。",
          );
      });
      port.postMessage({
        type,
        id,
        snapshot: data,
        force:
          type === "summarize"
            ? !!result
            : type === "ads"
              ? !!ads.length
              : false,
        ...extra,
      });
    } catch (error) {
      if (!busy || requestId !== id) return;
      fail(
        error.message?.includes("context invalidated")
          ? "插件已重新加载，请刷新视频页。"
          : error.message,
      );
    }
  }
  async function copy(text, button) {
    try {
      await navigator.clipboard.writeText(text);
      if (button.classList.contains("copy")) {
        button.title = "已复制";
        setTimeout(() => (button.title = "复制当前内容"), 1600);
      } else {
        const old = button.textContent;
        button.textContent = "已复制";
        setTimeout(() => (button.textContent = old), 1600);
      }
    } catch {
      status("复制失败，请选中内容后复制。");
    }
  }
  function exportSubtitles(format) {
    if (!transcript) return;
    const srtTime = (seconds) => {
      const ms = Math.round(seconds * 1000);
      return (
        String(Math.floor(ms / 3600000)).padStart(2, "0") +
        ":" +
        String(Math.floor(ms / 60000) % 60).padStart(2, "0") +
        ":" +
        String(Math.floor(ms / 1000) % 60).padStart(2, "0") +
        "," +
        String(ms % 1000).padStart(3, "0")
      );
    };
    const value =
      format === "json"
        ? JSON.stringify(transcript, null, 2)
        : format === "txt"
          ? transcript.subtitles.map((s) => s.text).join("\n")
          : transcript.subtitles
              .map(
                (s, i) =>
                  i +
                  1 +
                  "\n" +
                  srtTime(s.start) +
                  " --> " +
                  srtTime(s.end) +
                  "\n" +
                  s.text,
              )
              .join("\n\n");
    const link = create("a", undefined, {
      href: URL.createObjectURL(
        new Blob([value], { type: "text/plain;charset=utf-8" }),
      ),
      download: transcript.bvid + "-" + transcript.cid + "." + format,
    });
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  const adId = (s) => s.start + ":" + s.end;
  function clearAd() {
    adPending = null;
    adWidget?.remove();
    adWidget = null;
  }
  function skipAd(segment) {
    if (!video) return;
    const remaining = Math.max(0, segment.end - video.currentTime);
    video.currentTime = Math.min(
      video.duration || segment.end,
      segment.end + 0.05,
    );
    skipped.add(adId(segment));
    clearAd();
    if (remaining > 0)
      chrome.runtime
        .sendMessage({ type: "saved-seconds", seconds: remaining })
        .catch(() => {});
  }
  function adTick() {
    if (!video || !config().ai.enabled) {
      clearAd();
      return;
    }
    const settings = config().ai;
    const inRange = (kind) =>
      globalThis.BiliConfig?.inDurationRange(
        video.duration,
        settings[kind + "MinDuration"],
        settings[kind + "MaxDuration"],
      ) ?? true;
    if (
      settings.autoSummary &&
      !autoSummaryDone &&
      !busy &&
      !video.paused &&
      video.currentTime >= 15 &&
      inRange("summary")
    ) {
      void start("summarize", {}, false);
      return;
    }
    if (
      settings.autoAds &&
      !autoAdsDone &&
      !busy &&
      video.currentTime >= 15 &&
      !video.paused &&
      inRange("ad")
    ) {
      autoAdsDone = true;
      void start("ads", {}, false);
      return;
    }
    if (
      settings.autoAsr &&
      settings.asrFallback &&
      !autoAsrDone &&
      !busy &&
      !video.paused &&
      video.currentTime >= 15 &&
      inRange("asr")
    ) {
      void start("subtitles", {}, false);
      return;
    }
    if (!settings.skipAds || video.paused) {
      clearAd();
      return;
    }
    const segment = ads.find(
      (s) =>
        s.confidence >= settings.adThreshold &&
        video.currentTime >= s.start &&
        video.currentTime < s.end &&
        !kept.has(adId(s)) &&
        !skipped.has(adId(s)),
    );
    if (!segment) {
      clearAd();
      return;
    }
    if (adPending && adPending.segment !== segment) clearAd();
    if (!adPending) {
      adPending = { segment, started: Date.now() };
      const widget = create("div", undefined, {
        "data-bcx-ad-notice": "1",
        role: "status",
      });
      widget.style.cssText =
        "position:absolute;top:16px;left:16px;z-index:999999;background:#fff;color:#792341;border-radius:9px;padding:11px 14px;font:13px/1.7 sans-serif;box-shadow:0 4px 18px #0003";
      const text = create("span"),
        keep = create("button", "保留本段", { type: "button" });
      keep.style.cssText =
        "margin-left:12px;padding:4px 9px;border:1px solid #d9b9c9;border-radius:6px;background:#fff;color:#92244e;cursor:pointer";
      keep.addEventListener("click", () => {
        kept.add(adId(segment));
        clearAd();
      });
      widget.append(text, keep);
      const parent =
        document.fullscreenElement ||
        video.closest(".bpx-player-container") ||
        video.parentElement;
      parent.append(widget);
      adWidget = widget;
    }
    const left = Math.max(
      0,
      settings.skipCountdown -
        Math.floor((Date.now() - adPending.started) / 1000),
    );
    adWidget.firstChild.textContent =
      "检测到广告：" + segment.label + " · " + left + " 秒后跳过";
    if (left <= 0) skipAd(segment);
  }
  function unwatchVideo() {
    if (video && videoListener)
      for (const name of subtitleVideoEvents)
        video.removeEventListener(name, videoListener);
    video = null;
    videoListener = null;
  }
  function watchVideo() {
    const next = document.querySelector("video");
    if (next === video) return;
    unwatchVideo();
    if (!next || typeof next.addEventListener !== "function") {
      setActiveSubtitle(-1);
      return;
    }
    video = next;
    videoListener = () => {
      if (video !== document.querySelector("video")) return;
      syncSubtitle();
      adTick();
    };
    for (const name of subtitleVideoEvents)
      video.addEventListener(name, videoListener);
    syncSubtitle(true);
  }
  function removeMarkers() {
    for (const node of document.querySelectorAll?.("[data-bcx-marker]") || [])
      node.remove();
  }
  function markers() {
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0)
      return;
    const bar = document.querySelector(
      ".bpx-player-progress-wrap,.bpx-player-progress",
    );
    if (!bar || bar.querySelector("[data-bcx-marker]")) return;
    const records = [
      ...(result?.segments || []).map((s) => ({ ...s, kind: "chapter" })),
      ...ads.map((s) => ({ ...s, title: s.label, kind: "ad" })),
    ];
    for (const item of records) {
      const marker = create("button", undefined, {
        type: "button",
        "data-bcx-marker": item.kind,
        title: stamp(item.start) + " " + item.title,
        "aria-label": "跳转到 " + item.title,
      });
      marker.style.cssText =
        "position:absolute;left:" +
        (item.start / video.duration) * 100 +
        "%;bottom:0;height:7px;min-width:2px;width:" +
        (item.kind === "ad"
          ? Math.max(0.3, ((item.end - item.start) / video.duration) * 100) +
            "%"
          : "2px") +
        ";border:0;padding:0;background:" +
        (item.kind === "ad" ? "#d85b76" : "#b22c69") +
        ";z-index:8;cursor:pointer";
      marker.addEventListener("click", (event) => {
        event.stopPropagation();
        seek(item.start);
      });
      bar.append(marker);
    }
  }
  for (const button of all("[data-tab]"))
    button.addEventListener("click", () => tab(button.dataset.tab));
  $(".start").addEventListener("click", () => start());
  $(".read").addEventListener("click", () =>
    start("subtitles", { forceTranscript: !!transcript }),
  );
  $(".polish").addEventListener("click", () => start("polish"));
  $(".detect").addEventListener("click", () => start("ads"));
  $(".question-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const question = $("#question").value.trim();
    if (!question || busy) return;
    const previous = history.slice(-12);
    history.push({ role: "user", content: question });
    chatMessage("user", question);
    void start("chat", { question, history: previous });
  });
  $(".cancel").addEventListener("click", () => {
    requestId = "";
    if (port) port.postMessage({ type: "cancel" });
    stop();
    taskStates.set(taskPane(activeKind), { text: "已取消" });
    renderTaskState();
  });
  function copyContent() {
    if (selectedTab === "subtitles")
      return transcript
        ? transcript.subtitles
            .map((s) => stamp(s.start) + " " + s.text)
            .join("\n")
        : "";
    if (selectedTab === "chat")
      return history.some((item) => item.role === "assistant")
        ? history
            .map(
              (item) =>
                (item.role === "user" ? "提问：" : "回答：") + item.content,
            )
            .join("\n\n")
        : "";
    if (selectedTab === "ads")
      return ads.length
        ? ads
            .map(
              (s) =>
                stamp(s.start) +
                "–" +
                stamp(s.end) +
                " " +
                s.label +
                "\n" +
                s.reason +
                "\n置信度 " +
                Math.round(s.confidence * 100) +
                "%",
            )
            .join("\n\n")
        : $(".ads-result .hint")?.textContent || "";
    return result
      ? result.summary +
          "\n\n" +
          result.keyPoints.map((x) => "• " + x).join("\n") +
          "\n\n" +
          result.segments
            .map((s) => stamp(s.start) + " " + s.title + "\n" + s.summary)
            .join("\n\n")
      : "";
  }
  $(".copy").addEventListener("click", () => {
    const text = copyContent();
    if (text) copy(text, $(".copy"));
  });
  $(".copy-article").addEventListener("click", () =>
    copy(article, $(".copy-article")),
  );
  $(".export-format").addEventListener("change", (event) => {
    if (["srt", "txt", "json"].includes(event.target.value))
      exportSubtitles(event.target.value);
    event.target.value = "";
  });
  $(".transcript").addEventListener("click", (event) => {
    const row = event.target.closest?.(".subtitle-line");
    if (!row || !$(".transcript").contains(row)) return;
    const cue = transcript?.subtitles[Number(row.dataset.subtitleIndex)];
    if (!cue) return;
    subtitleScrollUntil = 0;
    seek(cue.start);
    syncSubtitle(true);
  });
  $(".transcript").addEventListener("wheel", pauseSubtitleFollow, {
    passive: true,
  });
  $(".transcript").addEventListener("touchstart", pauseSubtitleFollow, {
    passive: true,
  });
  $(".transcript").addEventListener("pointerdown", (event) => {
    if (event.target === $(".transcript")) pauseSubtitleFollow();
  });
  $(".transcript").addEventListener("keydown", (event) => {
    if (
      [
        "ArrowUp",
        "ArrowDown",
        "PageUp",
        "PageDown",
        "Home",
        "End",
        "Space",
      ].includes(event.code || event.key)
    )
      pauseSubtitleFollow();
    if (["Enter", "Space", " "].includes(event.code || event.key))
      event.stopPropagation();
  });
  $(".transcript").addEventListener("keyup", (event) => {
    if (["Enter", "Space", " "].includes(event.code || event.key))
      event.stopPropagation();
  });
  $(".follow-subtitle").addEventListener("click", () => {
    subtitleScrollUntil = 0;
    syncSubtitle(true);
  });
  $(".settings").addEventListener("click", () =>
    chrome.runtime.sendMessage({ type: "open-settings" }).catch(() => {}),
  );
  $(".collapse").addEventListener("click", () => {
    const collapsed = !host.hasAttribute("data-collapsed");
    host.toggleAttribute("data-collapsed", collapsed);
    $(".collapse").setAttribute("aria-expanded", String(!collapsed));
    $(".collapse").setAttribute(
      "aria-label",
      collapsed ? "展开视频助手" : "收起视频助手",
    );
    if (!collapsed) syncSubtitle(true);
  });
  launcher.addEventListener("click", () => {
    panel.hidden = false;
    launcher.hidden = true;
    launcher.setAttribute("aria-expanded", "true");
  });
  const show = () => {
    mount();
    host.removeAttribute("data-collapsed");
    $(".collapse").setAttribute("aria-expanded", "true");
    $(".collapse").setAttribute("aria-label", "收起视频助手");
    panel.hidden = false;
    launcher.hidden = true;
    launcher.setAttribute("aria-expanded", "true");
    host.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    sizePanel();
  };
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "open-panel") show();
  });
  window.addEventListener("bili-codex-layout-change", mount);
  window.addEventListener("bili-codex-layout-show", show);
  window.addEventListener("bili-codex-settings-change", mount);
  window.addEventListener(
    "load",
    () => {
      pageLoaded = true;
      mountStarted = Date.now();
      mount();
    },
    { once: true },
  );
  window.addEventListener("resize", sizePanel, { passive: true });
  const heightHandle = $(".panel-resizer");
  const changeHeight = (height, persist = false) => {
    manualHeight = Math.round(
      Math.max(360, Math.min(1600, Number(height) || 600)),
    );
    sizePanel();
    if (persist)
      chrome.storage?.local
        ?.set({ assistantPanelHeight: manualHeight })
        .catch(() => {});
  };
  heightHandle.addEventListener("pointerdown", (event) => {
    heightGesture = {
      y: event.clientY,
      height:
        parseFloat(host.style.getPropertyValue("--bcx-panel-height")) || 600,
    };
    heightHandle.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  heightHandle.addEventListener("pointermove", (event) => {
    if (heightGesture)
      changeHeight(heightGesture.height + event.clientY - heightGesture.y);
  });
  const finishHeight = () => {
    if (!heightGesture) return;
    heightGesture = null;
    changeHeight(manualHeight, true);
  };
  heightHandle.addEventListener("pointerup", finishHeight);
  heightHandle.addEventListener("pointercancel", finishHeight);
  heightHandle.addEventListener("keydown", (event) => {
    const code = event.code || event.key;
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(code)) return;
    event.preventDefault();
    const current =
      parseFloat(host.style.getPropertyValue("--bcx-panel-height")) || 600;
    changeHeight(
      code === "Home"
        ? 360
        : code === "End"
          ? 1600
          : current + (code === "ArrowDown" ? 40 : -40),
      true,
    );
  });
  heightHandle.addEventListener("dblclick", () => {
    manualHeight = 0;
    sizePanel();
    chrome.storage?.local?.remove("assistantPanelHeight").catch(() => {});
  });
  chrome.storage?.local
    ?.get("assistantPanelHeight")
    .then((data) => {
      const height = data?.assistantPanelHeight;
      if (
        typeof height === "number" &&
        Number.isFinite(height) &&
        height >= 360 &&
        height <= 1600 &&
        !heightGesture &&
        !manualHeight
      )
        changeHeight(height);
    })
    .catch(() => {});
  const separator = $(".summary-resizer");
  let resizingSummary = false;
  separator.addEventListener("pointerdown", (event) => {
    resizingSummary = true;
    separator.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  const summaryRatio = (value) => {
    const percent = Math.round(Math.max(30, Math.min(80, value)));
    $(".result").style.setProperty("--bcx-summary-ratio", percent + "%");
    separator.setAttribute("aria-valuenow", String(percent));
  };
  separator.addEventListener("pointermove", (event) => {
    if (!resizingSummary) return;
    const rect = $(".result").getBoundingClientRect();
    if (rect.height)
      summaryRatio(((event.clientY - rect.top) / rect.height) * 100);
  });
  separator.addEventListener("pointerup", () => {
    resizingSummary = false;
  });
  separator.addEventListener("pointercancel", () => {
    resizingSummary = false;
  });
  separator.addEventListener("keydown", (event) => {
    if (!["ArrowUp", "ArrowDown"].includes(event.code)) return;
    event.preventDefault();
    summaryRatio(
      Number(separator.getAttribute("aria-valuenow")) +
        (event.code === "ArrowUp" ? -5 : 5),
    );
  });
  setInterval(mount, 1000);
  mount();
})();
