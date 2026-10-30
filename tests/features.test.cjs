const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  crypto = require("node:crypto");
const { parseHTML } = require("linkedom");
const C = require("../extension/common/config.js");
const root = path.resolve(__dirname, "..");
const tick = () => new Promise(setImmediate);
function harness(
  html = '<div id="app"></div>',
  pathname = "/video/BV1ph4y1c7kp/",
) {
  const { window, document } = parseHTML(
    "<!doctype html><html><head></head><body>" + html + "</body></html>",
  );
  for (const player of document.querySelectorAll(
    "#playerWrap,#bilibili-player",
  )) {
    if (player.querySelector(".bpx-player-ctrl-playbackrate-menu")) continue;
    const control = document.createElement("div");
    control.className = "bpx-player-ctrl-playbackrate";
    control.innerHTML =
      '<span class="bpx-player-ctrl-playbackrate-result">倍速</span><ul class="bpx-player-ctrl-playbackrate-menu"><li class="bpx-player-ctrl-playbackrate-menu-item">1.0x</li></ul>';
    player.append(control);
  }
  const location = {
    hostname: "www.bilibili.com",
    pathname,
    search: "",
    href: "https://www.bilibili.com" + pathname,
  };
  const intervals = [],
    timeouts = [],
    patches = [];
  window.location = location;
  const chrome = {
    storage: {
      local: {
        get: async () => ({ biliSettings: {} }),
        set: async () => {},
        remove: async () => {},
      },
    },
    runtime: {
      getURL: (p) => "chrome-extension://test/" + p,
      onMessage: { addListener() {} },
      sendMessage: async () => ({
        ok: true,
        data: {
          title: "视频",
          pic: "https://i0.hdslb.com/a.jpg",
          desc: "简介",
        },
      }),
    },
  };
  const context = vm.createContext({
    window,
    top: window,
    document,
    location,
    chrome,
    URL,
    Blob,
    Response,
    TextEncoder,
    AbortController,
    crypto: crypto.webcrypto,
    Map,
    Set,
    WeakMap,
    CustomEvent: window.CustomEvent,
    Event: window.Event,
    innerWidth: 1400,
    innerHeight: 900,
    getComputedStyle: (node) => ({ position: node.style.position || "static" }),
    setInterval: (fn) => {
      intervals.push(fn);
      return intervals.length;
    },
    clearInterval() {},
    setTimeout: (fn) => {
      timeouts.push(fn);
      return timeouts.length;
    },
    clearTimeout(id) {
      if (id) timeouts[id - 1] = null;
    },
    navigator: { clipboard: { writeText: async () => {} } },
    console,
  });
  function load(file) {
    vm.runInContext(
      fs.readFileSync(path.join(root, "extension", file), "utf8"),
      context,
    );
  }
  load("common/config.js");
  load("common/ui.js");
  load("features/runtime.js");
  const state = {
    videos: new Map(),
    comments: new Map(),
    details: new Map(),
    history: { count: 0, index: 0 },
    patch: (key, value) => patches.push({ key, value }),
  };
  const start = (file, settings) => {
    load("features/" + file + ".js");
    return context.BiliFeatures.modules
      .at(-1)
      .start(C.normalize(settings), state);
  };
  return {
    window,
    document,
    context,
    location,
    intervals,
    timeouts,
    patches,
    load,
    start,
    state,
    chrome,
  };
}
test("configuration preserves user choices, bounds numbers, excludes unknown keys and backs up losslessly", () => {
  const input = {
    player: { speedEnabled: true, speed: 90, presets: [0, 1, 2, 9] },
    ai: { autoAds: true, adThreshold: 0.1 },
    purify: { hiddenElements: ["comments", "unknown"] },
    filter: { titleKeywords: [" A ", "A"] },
    unknown: { secret: "ignored" },
  };
  const value = C.normalize(input);
  assert.equal(value.player.speed, 5);
  assert.deepEqual(value.player.presets, [1, 2]);
  assert.equal(value.ai, undefined);
  assert.deepEqual(value.purify.hiddenElements, ["comments"]);
  assert(!("unknown" in value));
  assert.deepEqual(C.restore(C.backup(value)), value);
  assert.throws(() => C.restore({ settings: input }), /备份/);
  assert.throws(
    () => C.normalize({ filter: { minDuration: 10, maxDuration: 5 } }),
    /上限/,
  );
  assert.equal(C.normalize().player.speedEnabled, false);
  assert.equal(C.normalize().filter.enabled, false);
});
test("video filtering combines title, exact UP/UID and known numeric fields while ignoring unknown metadata", () => {
  const config = C.normalize({
    filter: {
      enabled: true,
      titleKeywords: ["剧透"],
      authorNames: ["BadUP"],
      authorIds: ["22"],
      minDuration: 60,
      maxDuration: 3600,
      minPlays: 100,
      ads: true,
      promoted: true,
      labels: true,
    },
  });
  assert(
    C.matchVideo(
      { title: "电影剧透", author: "good", duration: 30, plays: 50 },
      config,
    ).length >= 3,
  );
  assert(C.matchVideo({ author: "BadUP" }, config).includes("作者"));
  assert(C.matchVideo({ authorId: "22" }, config).includes("作者"));
  assert.deepEqual(C.matchVideo({ title: "正常视频" }, config), []);
  assert(C.matchVideo({ isAd: true }, config).includes("广告"));
  assert(
    C.matchVideo({ kind: "live" }, config).some((x) => x.includes("类型")),
  );
});
test("speed controls and shortcuts change the actual video and restore its original rate on stop", () => {
  const h = harness('<div id="playerWrap"><video></video></div>'),
    video = h.document.querySelector("video");
  video.playbackRate = 1;
  video.duration = 70;
  video.currentTime = 0;
  const stop = h.start("player", {
    player: { speedEnabled: true, speed: 2, presets: [1, 2, 3], step: 0.25 },
  });
  assert.equal(video.playbackRate, 2);
  const host = h.document.querySelector('[data-bcx-widget="speed"]');
  assert(host);
  host.querySelector('[data-bcx-speed-option="3"]').click();
  assert.equal(video.playbackRate, 3);
  assert.equal(h.patches.at(-1).value, 3);
  const event = new h.window.Event("keydown", { cancelable: true });
  Object.assign(event, { code: "ArrowUp", altKey: true });
  h.document.dispatchEvent(event);
  assert.equal(video.playbackRate, 3.25);
  stop();
  assert.equal(video.playbackRate, 1);
  assert(!h.document.querySelector('[data-bcx-widget="speed"]'));
});
test("fullscreen progress is attached inside the fullscreen target and seeks when dragged", () => {
  const h = harness('<div id="playerWrap"><video></video></div>'),
    video = h.document.querySelector("video"),
    parent = video.parentElement;
  video.duration = 70;
  video.currentTime = 1;
  h.document.fullscreenElement = parent;
  const stop = h.start("player", { player: { fullscreenProgress: true } });
  const progress = parent.querySelector(
    '[data-bcx-widget="fullscreen-progress"]',
  );
  assert(progress);
  const slider = progress.shadowRoot.querySelector("input");
  slider.value = 30;
  slider.dispatchEvent(new h.window.Event("input"));
  assert.equal(video.currentTime, 30);
  stop();
  assert(!parent.querySelector("[data-bcx-widget]"));
});
test("comment IP uses only captured public location and cleans added labels", () => {
  const h = harness(
    '<video></video><div id="commentapp"><a class="user-name" href="https://space.bilibili.com/22">用户</a></div>',
  );
  h.state.comments.set("uid:22", "浙江");
  const stop = h.start("player", { player: { commentIp: true } });
  assert.equal(h.document.querySelector("[data-bcx-ip]").textContent, "浙江");
  stop();
  assert(!h.document.querySelector("[data-bcx-ip]"));
});
test("filter/purify changes only matched local cards and restores all inserted attributes/styles", () => {
  const h = harness(
    '<div class="bili-video-card"><a href="https://www.bilibili.com/video/BV1ph4y1c7kp/" class="title">剧透分析</a></div><div class="bili-video-card"><a href="https://www.bilibili.com/video/BV1ab4y1c7kP/" class="title">教程</a></div><div class="rec-list">推荐列表</div>',
  );
  const stop = h.start("filter", {
    filter: { enabled: true, titleKeywords: ["剧透"] },
    purify: { hiddenElements: ["videoRecommendations"] },
  });
  const cards = h.document.querySelectorAll(".bili-video-card");
  assert(cards[0].hasAttribute("data-bcx-filtered"));
  assert(!cards[1].hasAttribute("data-bcx-filtered"));
  assert(
    [...h.document.querySelectorAll("style")].some((s) =>
      s.textContent.includes(".rec-list"),
    ),
  );
  stop();
  assert(!cards[0].hasAttribute("data-bcx-filtered"));
  assert.equal(h.document.querySelectorAll("style").length, 0);
});
test("right comments move player and comments then restore original parents and order", () => {
  const h = harness(
    '<main class="left-container"><h1>标题</h1><div id="playerWrap"><video></video></div><div class="basic-desc-info-text">简介</div><div id="commentapp">评论</div></main><aside class="right-container">推荐</aside>',
  );
  const player = h.document.querySelector("#playerWrap"),
    comments = h.document.querySelector("#commentapp"),
    parent = player.parentNode,
    old = parent.innerHTML;
  const stop = h.start("layout", { layout: { rightComments: true } });
  assert(player.closest("[data-bcx-player-column]"));
  assert(comments.closest("[data-bcx-comment-column]"));
  assert.equal(h.document.querySelectorAll("[data-bcx-tab]").length, 0);
  stop();
  assert.equal(player.parentNode, parent);
  assert.equal(comments.parentNode, parent);
  assert.equal(parent.innerHTML, old);
  assert(!h.document.documentElement.hasAttribute("data-bcx-wide-layout"));
});
test("minimal home and cover tools remove their entire UI and restore visibility state when disabled", () => {
  const h = harness('<div id="i_cecream">原首页</div>', "/");
  const stop = h.start("home", { home: { minimal: true } });
  assert(h.document.documentElement.hasAttribute("data-bcx-minimal"));
  assert(h.document.querySelector('[data-bcx-widget="minimal"]'));
  stop();
  assert(!h.document.documentElement.hasAttribute("data-bcx-minimal"));
  assert(!h.document.querySelector('[data-bcx-widget="minimal"]'));
  assert.equal(h.document.querySelector("#i_cecream").textContent, "原首页");
  const c = harness(
    '<div class="bili-video-card"><a href="https://www.bilibili.com/video/BV1ph4y1c7kp/">视频</a></div>',
    "/",
  );
  const off = c.start("home", { home: { coverZoom: true } });
  assert(c.document.querySelector("[data-bcx-cover]"));
  off();
  assert(!c.document.querySelector("[data-bcx-cover]"));
});
test("history without a native feed control never rewrites arbitrary Pinia arrays", async () => {
  const h = harness("<div></div>", "/");
  function XHR() {}
  XHR.prototype.open = () => {};
  XHR.prototype.send = () => {};
  h.context.XMLHttpRequest = XHR;
  const first = { bvid: "BV1ph4y1c7kp", goto: "av", title: "A" },
    second = { bvid: "BV1ab4y1c7kP", goto: "av", title: "B" };
  h.window.__pinia = { feed: { data: { recommend: { item: [first] } } } };
  let calls = 0;
  h.window.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ code: 0, data: { item: [second] } }), {
      headers: { "content-type": "application/json" },
    });
  };
  h.load("capture.js");
  h.window.dispatchEvent(
    new h.window.CustomEvent("bili-codex-config", {
      detail: JSON.stringify({ history: true, historyLimit: 8 }),
    }),
  );
  await h.window.fetch(
    "https://api.bilibili.com/x/web-interface/index/top/feed/rcmd",
  );
  await tick();
  await tick();
  h.window.dispatchEvent(
    new h.window.CustomEvent("bili-codex-history", {
      detail: JSON.stringify({ delta: -1 }),
    }),
  );
  assert.equal(h.window.__pinia.feed.data.recommend.item[0].title, "A");
  h.window.dispatchEvent(
    new h.window.CustomEvent("bili-codex-history", {
      detail: JSON.stringify({ delta: 1 }),
    }),
  );
  assert.equal(h.window.__pinia.feed.data.recommend.item[0].title, "A");
  assert.equal(calls, 1);
});
test("advanced rules retain custom shortcuts, duration limits, dates and known engagement fields", () => {
  const config = C.normalize({
    player: {
      speedUpShortcut: "Ctrl+Q",
      speedDownShortcut: "",
      presetShortcuts: ["Alt+1"],
      shortcutRates: [2.5],
    },
    ai: { autoSummary: true, summaryMinDuration: 60, summaryMaxDuration: 600 },
    filter: {
      enabled: true,
      minDanmaku: 5,
      minLikeRate: 2,
      publishedAfter: "2026-10-01",
      publishedBefore: "2026-10-31",
    },
  });
  assert(
    C.matchesShortcut(
      { code: "KeyQ", ctrlKey: true },
      config.player.speedUpShortcut,
    ),
  );
  assert(
    !C.matchesShortcut(
      { code: "KeyQ", ctrlKey: true, shiftKey: true },
      config.player.speedUpShortcut,
    ),
  );
  assert(!C.matchesShortcut({ code: "ArrowDown" }, ""));
  assert(!C.inDurationRange(59, 60, 600));
  assert(C.inDurationRange(600, 60, 600));
  assert(!C.inDurationRange(601, 60, 600));
  assert.deepEqual(
    C.matchVideo(
      {
        plays: 1000,
        likes: 10,
        danmaku: 3,
        publishedAt: Date.parse("2026-09-01T12:00:00Z") / 1000,
      },
      config,
    ),
    ["弹幕数", "点赞率", "发布日期"],
  );
  assert.deepEqual(C.matchVideo({}, config), []);
  assert.throws(
    () => C.normalize({ filter: { publishedAfter: "2026-02-30" } }),
    /日期/,
  );
  assert.throws(
    () => C.normalize({ player: { speedUpShortcut: "Run+Shell" } }),
    /快捷键/,
  );
  for (const pathname of [
    "/list/watchlater",
    "/list/12345678",
    "/video/BV1ph4y1c7kp/",
  ])
    assert(C.isPlaybackLocation({ pathname }));
  assert(!C.isPlaybackLocation({ pathname: "/list/not-a-list" }));
});

test("right comments attach a late native comment tree, persist comment width, and leave unrelated lists in place", () => {
  const h = harness(
    '<main id="mirror-vdcon"><div class="left-container"><h1>测试标题</h1><div id="playerWrap"><video></video></div><div class="basic-desc-info-text">原简介</div></div><aside class="right-container"></aside></main>',
  );
  const stop = h.start("layout", {
      layout: { rightComments: true, commentWidthPx: 460 },
    }),
    list = h.document.createElement("div"),
    comments = h.document.createElement("bili-comments");
  list.className = "video-pod";
  list.textContent = "稍后加载的合集";
  h.document.querySelector(".right-container").append(list);
  h.document.querySelector(".left-container").append(comments);
  h.intervals[0]();
  assert(comments.closest("[data-bcx-comment-column]"));
  assert.equal(list.parentElement.className, "right-container");
  assert(
    !h.document.querySelector("[data-bcx-tab],[data-bcx-widget=split-control]"),
  );
  const key = new h.window.Event("keydown", { cancelable: true });
  key.code = "ArrowLeft";
  h.document.querySelector("[role=separator]").dispatchEvent(key);
  assert.equal(h.patches.at(-1).key, "layout.commentWidthPx");
  assert.equal(h.patches.at(-1).value, 480);
  stop();
  assert.equal(comments.parentElement.className, "left-container");
  assert.equal(list.parentElement.className, "right-container");
  assert(!h.document.querySelector("[data-bcx-right-comments]"));
  h.intervals[0]();
  assert(
    !h.document.querySelector("[data-bcx-right-comments]"),
    "a stale scan cannot recreate a disabled right-comments layout",
  );
});

test("hover preview survives the gap between the card and its interactive timeline", async () => {
  const h = harness(
      '<div class="bili-video-card"><a href="https://www.bilibili.com/video/BV1ph4y1c7kp/">视频</a></div>',
      "/",
    ),
    card = h.document.querySelector(".bili-video-card");
  card.getBoundingClientRect = () => ({ left: 100, top: 100, bottom: 200 });
  h.chrome.runtime.sendMessage = async (m) => ({
    ok: true,
    data:
      m.task === "videoshot"
        ? {
            image: ["https://i0.hdslb.com/shot.jpg"],
            image_x_len: 2,
            image_y_len: 2,
            index: [0, 10, 20, 30],
          }
        : {
            title: "视频",
            desc: "简介",
            pic: "https://i0.hdslb.com/cover.jpg",
          },
  });
  const stop = h.start("home", { home: { preview: true } });
  card.dispatchEvent(new h.window.Event("pointerover", { bubbles: true }));
  h.timeouts[0]();
  await tick();
  await tick();
  const preview = h.document.querySelector("[data-bcx-widget=preview]");
  assert(preview?.shadowRoot.querySelector("input[type=range]"));
  card.dispatchEvent(new h.window.Event("pointerout", { bubbles: true }));
  assert(preview.isConnected);
  const pending = h.timeouts.length - 1;
  preview.dispatchEvent(new h.window.Event("pointerover", { bubbles: true }));
  assert.equal(h.timeouts[pending], null);
  assert(preview.isConnected);
  stop();
  assert(!preview.isConnected);
});

test("fast home loading triggers the native anchor then restores its style on disable", () => {
  const h = harness(
      '<div class="container is-version8"><div class="bili-feed-card"></div><div class="load-more-anchor" style="transform:scale(1)"></div></div>',
      "/",
    ),
    anchor = h.document.querySelector(".load-more-anchor");
  h.window.scrollY = 100;
  Object.defineProperty(h.document.documentElement, "scrollHeight", {
    value: 1400,
  });
  anchor.getBoundingClientRect = () => ({ bottom: 1600 });
  let scrolls = 0;
  h.window.addEventListener("scroll", () => scrolls++);
  const stop = h.start("home", { home: { optimizeLoading: true } });
  h.intervals[0]();
  assert(scrolls > 0);
  assert(anchor.style.transform.includes("translateY"));
  stop();
  assert.equal(anchor.style.transform, "scale(1)");
  assert.equal(anchor.style.visibility, undefined);
});

test("search suggestion text and local minimal background restore without altering saved files", async () => {
  const h = harness(
    '<input class="nav-search-input" placeholder="热门推荐" title="推荐词">',
    "/",
  );
  const off = h.start("filter", {
      purify: { hiddenElements: ["searchPlaceholder"] },
    }),
    input = h.document.querySelector("input");
  assert(!input.hasAttribute("placeholder"));
  off();
  assert.equal(input.getAttribute("placeholder"), "热门推荐");
  assert.equal(input.title, "推荐词");
  h.chrome.storage.local.get = async () => ({
    localBackground: {
      dataUrl: "data:image/png;base64,AAAA",
      name: "本地测试",
    },
  });
  const stop = h.start("home", {
    home: { minimal: true, backgroundSource: "local" },
  });
  await tick();
  assert(
    h.document
      .querySelector("[data-bcx-widget=minimal]")
      .style.backgroundImage.includes("data:image/png"),
  );
  stop();
});

function initCapture(h, fetch) {
  function XHR() {}
  XHR.prototype.open = () => {};
  XHR.prototype.send = () => {};
  h.context.XMLHttpRequest = XHR;
  h.window.fetch = fetch;
  const packets = [];
  h.window.addEventListener("bili-codex-data", (event) =>
    packets.push(JSON.parse(event.detail)),
  );
  h.load("capture.js");
  return packets;
}
test("initial and WBI recommendation metadata reach numeric filters even with history disabled", async () => {
  const h = harness("<div></div>", "/"),
    first = {
      bvid: "BV1ph4y1c7kp",
      title: "首批",
      stat: { view: 120, like: 8, danmaku: 7 },
      pubdate: 1700000000,
    };
  h.window.__pinia = { feed: { data: { recommend: { item: [first] } } } };
  const packets = initCapture(
    h,
    async () =>
      new Response(
        JSON.stringify({ data: { item: [{ ...first, title: "WBI首批" }] } }),
      ),
  );
  h.window.dispatchEvent(
    new h.window.CustomEvent("bili-codex-config", {
      detail: JSON.stringify({ history: false, videoMetadata: true }),
    }),
  );
  assert.equal(packets.find((p) => p.videos)?.videos[0].danmaku, 7);
  await h.window.fetch(
    "https://api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd",
  );
  await tick();
  await tick();
  assert(packets.some((p) => p.videos?.[0]?.title === "WBI首批"));
});

function extensionPage(file, initial = {}) {
  const source = fs.readFileSync(
      path.join(root, "extension", file + ".html"),
      "utf8",
    ),
    body = source.match(/<body[^>]*>([\s\S]*)<\/body>/)[1],
    h = harness(body),
    storage = { ...initial };
  h.location.hash = "";
  // Linkedom omits the browser's writable select.value; emulate that DOM contract.
  Object.defineProperty(h.window.HTMLSelectElement.prototype, "value", {
    configurable: true,
    get() {
      return (
        this.querySelector("option[selected]")?.value ||
        this.querySelector("option")?.value ||
        ""
      );
    },
    set(value) {
      for (const option of this.querySelectorAll("option"))
        option.toggleAttribute("selected", option.value === String(value));
    },
  });
  h.chrome.runtime.getManifest = () => ({ version: "2.0.0" });
  h.chrome.storage.local = {
    get: async (key) =>
      Array.isArray(key)
        ? Object.fromEntries(key.map((k) => [k, storage[k]]))
        : key === null
          ? { ...storage }
          : { [key]: storage[key] },
    set: async (value) => Object.assign(storage, structuredClone(value)),
    remove: async (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys])
        delete storage[key];
    },
  };
  if (file === "options") h.load("common/settings-fields.js");
  h.load(file + ".js");
  return { ...h, storage };
}
test("settings page saves advanced fields and hidden rules while preserving local background and cache on normal save", async () => {
  const h = extensionPage("options", {
    localBackground: { dataUrl: "data:image/png;base64,AAAA" },
    "ai:cached": { result: "保留" },
  });
  await tick();
  assert.equal(h.document.querySelector("#version").textContent, "2.0.0");
  assert(h.document.querySelectorAll("[data-key]").length > 30);
  const keyword = h.document.querySelector('[data-key="filter.titleKeywords"]');
  keyword.value = "剧透\n推广";
  keyword.dispatchEvent(new h.window.Event("input"));
  const theme = h.document.querySelector('[data-key="appearance.theme"]');
  theme.value = "dark";
  theme.dispatchEvent(new h.window.Event("input"));
  const speed = h.document.querySelector('[data-key="player.speedEnabled"]');
  speed.checked = true;
  speed.dispatchEvent(new h.window.Event("change"));
  h.document.querySelector('[data-hidden-rule="searchPlaceholder"]').click();
  h.document.querySelector("#save").click();
  await tick();
  assert.equal(h.storage.biliSettings.player.speedEnabled, true);
  assert.deepEqual(h.storage.biliSettings.filter.titleKeywords, [
    "剧透",
    "推广",
  ]);
  assert.equal(h.storage.biliSettings.appearance.theme, "dark");
  assert(h.storage.localBackground);
  assert(h.storage["ai:cached"]);
  assert(h.document.querySelector("#status").textContent.includes("已保存"));
});

test("popup quick switches persist and reflect the real manifest version", async () => {
  const h = extensionPage("popup");
  await tick();
  assert(h.document.querySelector("#version").textContent.includes("2.0.0"));
  const speed = [...h.document.querySelectorAll("#groups label")]
    .find((label) => label.textContent.includes("倍速"))
    .querySelector("input");
  speed.checked = true;
  speed.dispatchEvent(new h.window.Event("change"));
  await tick();
  assert.equal(h.storage.biliSettings.player.speedEnabled, true);
  assert(h.document.querySelector("#quote").textContent.length > 0);
});

test("settings remain saveable when old AI cache fills the Chrome storage quota", async () => {
  const h = extensionPage("options", {
    "ai:old": { result: "replaceable" },
    localBackground: { dataUrl: "data:image/png;base64,AAAA" },
  });
  await tick();
  const write = h.chrome.storage.local.set;
  let calls = 0;
  h.chrome.storage.local.set = async (value) => {
    if (calls++ === 0) throw Error("QUOTA_BYTES quota exceeded");
    return write(value);
  };
  h.document.querySelector("#save").click();
  await tick();
  assert.equal(calls, 2);
  assert(h.storage.biliSettings);
  assert(h.storage.localBackground);
  assert(!h.storage["ai:old"]);
  assert(h.document.querySelector("#status").textContent.includes("已保存"));
});
