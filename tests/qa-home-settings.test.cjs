"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const { parseHTML } = require("linkedom");
const root = path.resolve(
  process.env.BILI_TEST_SOURCE_ROOT || path.join(__dirname, ".."),
);
const C = require(path.join(root, "extension/common/config.js"));
const flush = () => new Promise(setImmediate);
const plain = (x) => JSON.parse(JSON.stringify(x));
const bv = (n) => "BV" + String(1000000000 + n);
const card = (n = 1, title = "普通教程") =>
  `<div class="bili-video-card"><a class="title" href="https://www.bilibili.com/video/${bv(n)}">${title}</a><a class="up-name" href="https://space.bilibili.com/22">TestUP</a><span class="duration">02:00</span><span class="play">1.2万</span><img loading="lazy" decoding="sync" src="https://i0.hdslb.com/original.jpg"></div>`;
function harness(html = "", initial = {}, pathname = "/") {
  const { window, document } = parseHTML(
    `<!doctype html><html><head></head><body>${html}</body></html>`,
  );
  const location = {
    hostname: "www.bilibili.com",
    pathname,
    search: "",
    hash: "",
    href: "https://www.bilibili.com" + pathname,
  };
  window.location = location;
  window.scrollY = 0;
  let now = 0,
    serial = 0,
    dark = false,
    closed = 0;
  const timers = new Map(),
    storage = { ...initial },
    storageListeners = [],
    messages = [],
    writes = [],
    removed = [],
    downloads = [];
  const schedule = (fn, ms = 0, repeat = false) => {
    const id = ++serial;
    timers.set(id, { fn, due: now + ms, ms, repeat });
    return id;
  };
  const advance = (ms) => {
    const until = now + ms;
    let count = 0;
    while (true) {
      const t = [...timers].sort((a, b) => a[1].due - b[1].due)[0];
      if (!t || t[1].due > until) break;
      assert(++count < 5000, "virtual timers settle");
      const [id, v] = t;
      now = v.due;
      v.repeat ? (v.due += v.ms) : timers.delete(id);
      v.fn();
    }
    now = until;
  };
  class Clock extends Date {
    static now() {
      return now;
    }
  }
  class ObjectURL extends URL {
    static createObjectURL(blob) {
      downloads.push(blob);
      return "blob:fixture-" + downloads.length;
    }
    static revokeObjectURL() {}
  }
  Object.defineProperty(window.HTMLSelectElement.prototype, "value", {
    configurable: true,
    get() {
      return (
        this.querySelector("option[selected]")?.value ||
        this.querySelector("option")?.value ||
        ""
      );
    },
    set(v) {
      for (const o of this.querySelectorAll("option"))
        o.toggleAttribute("selected", o.value === String(v));
    },
  });
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return {
      top: 150,
      left: 20,
      bottom: 350,
      right: 320,
      width: 300,
      height: 200,
    };
  };
  const create = document.createElement.bind(document);
  document.createElement = (tag, ...args) => {
    const n = create(tag, ...args);
    if (tag === "dialog") {
      n.showModal = () => n.setAttribute("open", "");
      n.close = () => {
        n.removeAttribute("open");
        n.dispatchEvent(new window.Event("close"));
      };
    }
    return n;
  };
  window.matchMedia = () => ({ matches: dark });
  window.close = () => closed++;
  const chrome = {
    storage: {
      onChanged: { addListener: (fn) => storageListeners.push(fn) },
      local: {
        get: async (key) =>
          key === null
            ? { ...storage }
            : Array.isArray(key)
              ? Object.fromEntries(key.map((k) => [k, storage[k]]))
              : { [key]: storage[key] },
        set: async (values) => {
          writes.push(plain(values));
          Object.assign(storage, structuredClone(values));
          for (const fn of storageListeners)
            fn(
              Object.fromEntries(
                Object.keys(values).map((k) => [k, { newValue: values[k] }]),
              ),
              "local",
            );
        },
        remove: async (keys) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            removed.push(key);
            delete storage[key];
          }
        },
      },
    },
    runtime: {
      getManifest: () =>
        JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"))),
      getURL: (p) => "/extension/" + p,
      openOptionsPage: async () => messages.push({ type: "open-options" }),
      sendMessage: async (m) => {
        messages.push(m);
        return {
          ok: true,
          version: "fixture",
          asrReady: true,
          data:
            m.task === "videoshot"
              ? {
                  image: [
                    "https://i0.hdslb.com/sheet0.jpg",
                    "https://i0.hdslb.com/sheet1.jpg",
                  ],
                  image_x_len: 2,
                  image_y_len: 2,
                  index: [0, 1, 2, 3, 4, 5, 6, 7],
                }
              : {
                  title: "测试标题",
                  desc: "测试简介",
                  pic: "https://i0.hdslb.com/original.jpg",
                },
        };
      },
    },
    tabs: {
      query: async () => [{ id: 1 }],
      sendMessage: async (id, message) => messages.push({ id, ...message }),
    },
  };
  const context = vm.createContext({
    window,
    document,
    location,
    chrome,
    URL: ObjectURL,
    Blob,
    Response,
    Request,
    TextEncoder,
    TextDecoder,
    Date: Clock,
    CustomEvent: window.CustomEvent,
    Event: window.Event,
    innerWidth: 1400,
    innerHeight: 900,
    getComputedStyle: (n) => ({
      position: n.style.position || "static",
      display: n.hidden ? "none" : "block",
      visibility: "visible",
    }),
    setTimeout: (f, ms) => schedule(f, ms),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (f, ms) => schedule(f, ms, true),
    clearInterval: (id) => timers.delete(id),
    console,
  });
  const load = (file) =>
    vm.runInContext(
      fs.readFileSync(path.join(root, "extension", file), "utf8"),
      context,
      { filename: file },
    );
  for (const file of [
    "common/config.js",
    "common/ui.js",
    "subtitles.js",
    "features/runtime.js",
  ])
    load(file);
  const state = {
    videos: new Map(),
    details: new Map(),
    history: { count: 0, index: 0 },
    filterTripped: false,
    settings: () => C.normalize(initial.biliSettings),
  };
  const start = (file, settings) => {
    load("features/" + file + ".js");
    return context.BiliFeatures.modules
      .at(-1)
      .start(C.normalize(settings), state);
  };
  const settle = async () => {
    for (let i = 0; i < 8; i++) await flush();
  };
  return {
    window,
    document,
    context,
    location,
    chrome,
    storage,
    messages,
    writes,
    removed,
    downloads,
    timers,
    advance,
    load,
    start,
    state,
    settle,
    setDark: (v) => (dark = v),
    closed: () => closed,
  };
}
async function page(name, initial = {}) {
  const h = harness(
    fs
      .readFileSync(path.join(root, "extension", name + ".html"), "utf8")
      .match(/<body[^>]*>([\s\S]*)<\/body>/)[1],
    initial,
    "/extension/" + name + ".html",
  );
  if (name === "options") h.load("common/settings-fields.js");
  h.load(name + ".js");
  await h.settle();
  return h;
}
function setInput(h, selector, value, type = "input") {
  const n = h.document.querySelector(selector);
  assert(n, selector);
  if (n.type === "checkbox") n.checked = value;
  else n.value = value;
  n.dispatchEvent(new h.window.Event(type, { bubbles: true }));
  return n;
}
function event(h, target, type, props = {}) {
  const e = new h.window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, props);
  target.dispatchEvent(e);
  return e;
}
function modelPort(h) {
  const connections = [];
  h.chrome.runtime.connect = (options) => {
    const messages = [],
      disconnects = [],
      posts = [];
    const port = {
      options,
      posts,
      disconnected: false,
      onMessage: { addListener: (fn) => messages.push(fn) },
      onDisconnect: { addListener: (fn) => disconnects.push(fn) },
      postMessage: (message) => posts.push(plain(message)),
      disconnect() {
        if (this.disconnected) return;
        this.disconnected = true;
        for (const fn of disconnects) fn();
      },
      async fire(message) {
        await Promise.all(messages.map((fn) => fn(message)));
      },
    };
    connections.push(port);
    return port;
  };
  return connections;
}

test("QAHS-01 all five numeric filter ranges enforce both ends and ignore unknown fields", () => {
  for (const [field, name, item] of [
    ["duration", "Duration", { duration: 5 }],
    ["plays", "Plays", { plays: 5 }],
    ["likes", "Likes", { likes: 5 }],
    ["danmaku", "Danmaku", { danmaku: 5 }],
    ["likeRate", "LikeRate", { likes: 5, plays: 100 }],
  ]) {
    const cfg = C.normalize({
      filter: { enabled: true, ["min" + name]: 10, ["max" + name]: 20 },
    });
    assert(C.matchVideo(item, cfg).length, field + " minimum");
    const high =
      field === "likeRate" ? { likes: 25, plays: 100 } : { [field]: 25 };
    assert(C.matchVideo(high, cfg).length, field + " maximum");
    const good =
      field === "likeRate" ? { likes: 15, plays: 100 } : { [field]: 15 };
    assert.deepEqual(C.matchVideo(good, cfg), [], field + " in range");
    assert.deepEqual(C.matchVideo({}, cfg), [], field + " missing");
    assert.throws(
      () => C.normalize({ filter: { ["min" + name]: 20, ["max" + name]: 10 } }),
      /上限/,
    );
  }
});
test("QAHS-02 title contains, author exact/UID, publication dates, and independent type/ad filters", () => {
  const cfg = C.normalize({
    filter: {
      enabled: true,
      titleKeywords: ["Spoiler"],
      authorNames: ["TestUP"],
      authorIds: ["22"],
      publishedAfter: "2026-10-01",
      publishedBefore: "2026-10-31",
    },
  });
  assert(C.matchVideo({ title: "a SPOILER here" }, cfg).includes("标题关键词"));
  assert(C.matchVideo({ author: "testup" }, cfg).includes("作者"));
  assert.deepEqual(C.matchVideo({ author: "TestUP extra" }, cfg), []);
  assert(C.matchVideo({ authorId: 22 }, cfg).includes("作者"));
  const at = (s) => new Date(s).getTime() / 1000;
  assert(
    C.matchVideo({ publishedAt: at("2026-09-30T12:00:00") }, cfg).includes(
      "发布日期",
    ),
  );
  assert.deepEqual(
    C.matchVideo({ publishedAt: at("2026-10-31T23:59:59") }, cfg),
    [],
  );
  assert(
    C.matchVideo({ publishedAt: at("2026-11-01T00:00:00") }, cfg).includes(
      "发布日期",
    ),
  );
  assert.throws(
    () => C.normalize({ filter: { publishedAfter: "2026-02-30" } }),
    /发布日期/,
  );
  assert.throws(
    () =>
      C.normalize({
        filter: { publishedAfter: "2026-11-01", publishedBefore: "2026-10-01" },
      }),
    /起点/,
  );
  const independent = C.normalize({
    filter: { enabled: false, ads: true, promoted: true, labels: true },
  });
  for (const kind of ["live", "bangumi", "course"])
    assert(C.matchVideo({ kind }, independent).length, kind);
  assert(C.matchVideo({ isAd: true }, independent).includes("广告"));
  assert(C.matchVideo({ promoted: true }, independent).includes("推广"));
});
test("QAHS-03 real index/captured metadata updates numeric filtering and setting-off restores cards", async () => {
  const h = harness(card(), {
    biliSettings: { filter: { enabled: true, minLikes: 100 } },
  });
  h.load("features/filter.js");
  h.load("features/index.js");
  await h.settle();
  const node = h.document.querySelector(".bili-video-card");
  assert(!node.hasAttribute("data-bcx-filtered"));
  event(h, h.window, "bili-codex-data", {
    detail: JSON.stringify({ videos: [{ bvid: bv(1), likes: 5 }] }),
  });
  h.advance(1200);
  assert(node.hasAttribute("data-bcx-filtered"));
  h.context.BiliFeatures.context.patch("filter.enabled", false);
  assert(!node.hasAttribute("data-bcx-filtered"));
  h.advance(600);
  await h.settle();
  assert.equal(h.storage.biliSettings.filter.enabled, false);
});
test("QAHS-04 three hidden batches pause rules but must keep independently enabled ad filtering active immediately", () => {
  const h = harness('<section id="feed"></section>');
  const feed = h.document.querySelector("#feed");
  const render = (n) => {
    feed.innerHTML =
      card(n, "blocked tutorial") +
      `<div class="bili-video-card"><a href="https://www.bilibili.com/video/${bv(n + 100)}" class="title">advert</a><span class="bili-video-card__info--ad">广告</span></div>`;
  };
  render(1);
  const stop = h.start("filter", {
    filter: { enabled: true, titleKeywords: ["blocked"], ads: true },
  });
  render(2);
  h.advance(1200);
  render(3);
  h.advance(1200);
  assert.equal(h.state.filterTripped, true);
  assert(h.document.querySelector('[data-bcx-widget="filter-notice"]'));
  const cards = [...feed.querySelectorAll(".bili-video-card")];
  assert(!cards[0].hasAttribute("data-bcx-filtered"));
  assert(
    cards[1].hasAttribute("data-bcx-filtered"),
    "independent ad filter cannot flash open when rule guard trips",
  );
  stop();
  assert(!h.document.querySelector('[data-bcx-widget="filter-notice"]'));
});
test("QAHS-05 all twelve purify entries inject their selector and restore search hint attributes and styles", () => {
  const h = harness(
    '<input class="nav-search-input" placeholder="热搜词" title="原始标题">',
  );
  const stop = h.start("filter", {
    purify: { ads: true, hiddenElements: Object.keys(C.HIDDEN) },
  });
  const css = [...h.document.querySelectorAll("style")]
    .map((n) => n.textContent)
    .join("\n");
  for (const [key, rule] of Object.entries(C.HIDDEN))
    if (rule.css) assert(css.includes(rule.css), key);
  assert(css.includes(".ad-report"));
  const input = h.document.querySelector("input");
  assert.equal(input.getAttribute("placeholder"), null);
  assert.equal(input.getAttribute("title"), null);
  stop();
  assert.equal(input.getAttribute("placeholder"), "热搜词");
  assert.equal(input.title, "原始标题");
  assert.equal(h.document.querySelectorAll("style").length, 0);
});
test("QAHS-06 minimal homepage search encodes query, accepts HTTPS/local background, and disables cleanly", async () => {
  const h = harness('<div id="i_cecream">原首页</div>');
  const stop = h.start("home", {
    home: {
      minimal: true,
      backgroundUrl: "https://example.test/background.jpg",
    },
  });
  let host = h.document.querySelector('[data-bcx-widget="minimal"]');
  assert(host.style.backgroundImage.includes("https://example.test"));
  host.shadowRoot.querySelector("input").value = "视频 A&B";
  event(h, host.shadowRoot.querySelector("form"), "submit");
  assert.equal(
    h.location.href,
    "https://search.bilibili.com/all?keyword=" + encodeURIComponent("视频 A&B"),
  );
  stop();
  assert.equal(
    h.document.querySelectorAll('[data-bcx-widget="minimal"]').length,
    0,
  );
  assert.equal(
    h.document.documentElement.getAttribute("data-bcx-minimal"),
    null,
  );
  assert.equal(h.document.querySelector("#i_cecream").textContent, "原首页");
  const local = harness("", {
    localBackground: {
      dataUrl: "data:image/webp;base64,AAAA",
      width: 5,
      height: 5,
    },
  });
  const off = local.start("home", {
    home: { minimal: true, backgroundSource: "local" },
  });
  await local.settle();
  host = local.document.querySelector('[data-bcx-widget="minimal"]');
  assert(host.style.backgroundImage.includes("data:image/webp"));
  off();
  assert.throws(
    () =>
      C.normalize({
        home: { backgroundUrl: "http://example.test/unsafe.jpg" },
      }),
    /HTTPS/,
  );
});
test("QAHS-07 hover preview waits configured delay, renders description and multiple sprite sheets, and cleans on stop", async () => {
  const h = harness(card());
  const stop = h.start("home", { home: { preview: true, previewDelay: 300 } });
  const node = h.document.querySelector(".bili-video-card");
  event(h, node, "pointerover");
  h.advance(299);
  assert(!h.document.querySelector('[data-bcx-widget="preview"]'));
  h.advance(1);
  await h.settle();
  const host = h.document.querySelector('[data-bcx-widget="preview"]'),
    shadow = host.shadowRoot;
  assert.equal(shadow.querySelector("h3").textContent, "测试标题");
  assert.equal(shadow.querySelector(".copy p").textContent, "测试简介");
  const slider = shadow.querySelector('input[type="range"]');
  slider.value = 5;
  event(h, slider, "input");
  assert.equal(
    shadow.querySelector("img").src,
    "https://i0.hdslb.com/sheet1.jpg",
  );
  assert.equal(
    shadow.querySelector("img").style.transform,
    "translate(-340px,0px)",
  );
  stop();
  assert(!h.document.querySelector('[data-bcx-widget="preview"]'));
});
test("QAHS-08 pending preview API completion cannot recreate a disabled preview", async () => {
  const h = harness(card());
  let resolve;
  h.chrome.runtime.sendMessage = () => new Promise((r) => (resolve = r));
  const stop = h.start("home", { home: { preview: true, previewDelay: 200 } });
  event(h, h.document.querySelector(".bili-video-card"), "pointerover");
  h.advance(200);
  stop();
  resolve({
    ok: true,
    data: { title: "迟到", pic: "https://i0.hdslb.com/a.jpg" },
  });
  await h.settle();
  assert(!h.document.querySelector('[data-bcx-widget="preview"]'));
});
test("QAHS-09 an already open cover dialog must be removed when the cover feature is disabled", async () => {
  const h = harness(card());
  const stop = h.start("home", { home: { coverZoom: true } });
  h.document.querySelector("[data-bcx-cover]").click();
  await h.settle();
  assert(h.document.querySelector("dialog[open]"));
  stop();
  assert(
    !h.document.querySelector("dialog"),
    "feature disable must clean its modal and focus-blocking backdrop",
  );
});
test("QAHS-10 late cover API completion must not open a modal after the feature was disabled", async () => {
  const h = harness(card());
  let resolve;
  h.chrome.runtime.sendMessage = () => new Promise((r) => (resolve = r));
  const stop = h.start("home", { home: { coverZoom: true } });
  h.document.querySelector("[data-bcx-cover]").click();
  stop();
  resolve({
    ok: true,
    data: { pic: "https://i0.hdslb.com/a.jpg", title: "迟到" },
  });
  await h.settle();
  assert(
    !h.document.querySelector("dialog"),
    "late work cannot resurrect disabled UI",
  );
});
test("QAHS-11 load optimization eagerly loads nearby images, prefetches once, restores attributes, and respects timeout cooldown", async () => {
  const h = harness(
    card() +
      '<div class="load-more-anchor" style="transform:scale(1);visibility:visible;pointer-events:auto"></div>',
  );
  const image = h.document.querySelector("img"),
    anchor = h.document.querySelector(".load-more-anchor");
  anchor.getBoundingClientRect = () => ({
    top: 1100,
    bottom: 1150,
    width: 50,
    height: 50,
  });
  h.document.documentElement.scrollHeight = 1500;
  let scrolls = 0;
  h.window.addEventListener("scroll", () => scrolls++);
  const stop = h.start("home", {
    home: {
      optimizeLoading: true,
      unlockTimeoutMs: 1000,
      maxConsecutiveTimeouts: 1,
      cooldownMs: 3000,
      routeCheckIntervalMs: 250,
    },
  });
  await h.settle();
  assert.equal(h.messages.filter((m) => m.task === "view").length, 1);
  assert.equal(image.loading, "eager");
  h.advance(250);
  assert.equal(scrolls, 1);
  assert.equal(anchor.style.visibility, "hidden");
  h.advance(300);
  assert.equal(anchor.style.visibility, "visible");
  h.advance(1000);
  assert.equal(scrolls, 1, "cooldown must prevent immediate retry");
  h.advance(3000);
  assert(scrolls >= 2, "loading retries after cooldown");
  assert.equal(
    h.messages.filter((m) => m.task === "view").length,
    1,
    "prefetch is deduplicated",
  );
  stop();
  assert.equal(image.getAttribute("loading"), "lazy");
  assert.equal(image.getAttribute("decoding"), "sync");
  assert.equal(anchor.style.transform, "scale(1)");
  assert.equal(h.timers.size, 0);
});
test("QAHS-12 popup toggles persist, favorite controls render, collapsed groups persist, and themes/quote/status work", async () => {
  const h = await page("popup", {
    biliSettings: {
      appearance: {
        favoriteFeatureIds: ["home.preview"],
        dailyQuoteEnabled: true,
      },
    },
  });
  assert(
    h.document
      .querySelector("#version")
      .textContent.includes(
        JSON.parse(fs.readFileSync(path.join(root, "package.json"))).version,
      ),
  );
  assert(h.document.querySelector("#quote").textContent.length);
  const input = h.document.querySelector("#favorites input");
  assert.equal(input.getAttribute("aria-label"), "极速预览");
  input.checked = true;
  event(h, input, "change");
  await h.settle();
  assert.equal(h.storage.biliSettings.home.preview, true);
  const details = h.document.querySelector("#groups details");
  details.open = true;
  event(h, details, "toggle");
  await h.settle();
  assert(
    !h.storage.biliSettings.appearance.popupGroupCollapseState.includes(
      "player",
    ),
  );
  h.document.querySelector("#theme").click();
  await h.settle();
  assert.equal(h.storage.biliSettings.appearance.theme, "light");
  h.document.querySelector("#theme").click();
  await h.settle();
  assert.equal(h.document.documentElement.getAttribute("data-theme"), "dark");
  h.document.querySelector("#check").click();
  await h.settle();
  assert(
    h.document.querySelector("#status").textContent.includes("转写已就绪"),
  );
  h.document.querySelector("#settings").click();
  h.document.querySelector("#show").click();
  await h.settle();
  assert(h.messages.some((m) => m.type === "open-options"));
  assert(h.messages.some((m) => m.type === "open-panel"));
  assert.equal(h.closed(), 1);
});
test("QAHS-13 options expose every declared field and hidden rule, save all rule types and reload persisted values", async () => {
  const h = await page("options");
  const specs = Object.values(h.context.BiliSettingsFields).flat();
  for (const spec of specs)
    assert(h.document.querySelector(`[data-key="${spec.key}"]`), spec.key);
  for (const key of Object.keys(C.HIDDEN))
    assert(h.document.querySelector(`[data-hidden-rule="${key}"]`), key);
  setInput(h, '[data-key="filter.titleKeywords"]', "中文\nSpoiler");
  setInput(h, '[data-key="filter.authorNames"]', "TestUP");
  setInput(h, '[data-key="filter.authorIds"]', "22");
  setInput(h, '[data-key="filter.minLikes"]', "100");
  setInput(h, '[data-key="filter.publishedAfter"]', "2026-10-01");
  setInput(h, '[data-key="appearance.theme"]', "dark");
  h.document.querySelector('[data-favorite="home.preview"]').click();
  setInput(h, '[data-hidden-rule="comments"]', true, "change");
  h.document.querySelector("#save").click();
  await h.settle();
  assert.equal(h.storage.biliSettings.filter.minLikes, 100);
  assert.deepEqual(h.storage.biliSettings.filter.titleKeywords, [
    "中文",
    "Spoiler",
  ]);
  assert(
    h.storage.biliSettings.appearance.favoriteFeatureIds.includes(
      "home.preview",
    ),
  );
  assert(h.storage.biliSettings.purify.hiddenElements.includes("comments"));
  const reload = await page("options", h.storage);
  assert.equal(
    reload.document.querySelector('[data-key="filter.minLikes"]').value,
    "100",
  );
  assert.equal(
    reload.document.documentElement.getAttribute("data-theme"),
    "dark",
  );
});
test("QAHS-14 options export/import round trip settings and background, reject invalid JSON and oversized backup, reset needs save", async () => {
  const bg = {
    dataUrl: "data:image/webp;base64,AAAA",
    width: 100,
    height: 100,
    name: "本地背景",
  };
  const h = await page("options", {
    biliSettings: { home: { preview: true } },
    localBackground: bg,
  });
  h.document.querySelector("#export").click();
  await h.settle();
  const backup = JSON.parse(await h.downloads[0].text());
  assert.equal(backup.settings.home.preview, true);
  assert.equal(backup.localBackground.name, "本地背景");
  assert(!("diagnostics" in backup));
  const importer = h.document.querySelector("#import");
  Object.defineProperty(importer, "files", {
    configurable: true,
    value: [
      {
        size: 100,
        text: async () =>
          JSON.stringify(C.backup(C.normalize({ home: { minimal: true } }))),
      },
    ],
  });
  event(h, importer, "change");
  await h.settle();
  assert.equal(
    h.storage.biliSettings.home.preview,
    true,
    "import does not write before Save",
  );
  h.document.querySelector("#save").click();
  await h.settle();
  assert.equal(h.storage.biliSettings.home.minimal, true);
  assert.equal(h.storage.localBackground, undefined);
  Object.defineProperty(importer, "files", {
    configurable: true,
    value: [{ size: 10, text: async () => "{bad" }],
  });
  event(h, importer, "change");
  await h.settle();
  assert(h.document.querySelector("#status").classList.contains("error"));
  Object.defineProperty(importer, "files", {
    configurable: true,
    value: [{ size: 6 * 1024 * 1024, text: async () => "{}" }],
  });
  event(h, importer, "change");
  await h.settle();
  assert(h.document.querySelector("#status").textContent.includes("5MB"));
  h.document.querySelector("#reset").click();
  assert.equal(h.storage.biliSettings.home.minimal, true);
  h.document.querySelector("#save").click();
  await h.settle();
  assert.equal(h.storage.biliSettings.home.minimal, false);
});
test("QAHS-15 failed import with invalid background must not partly replace settings behind the unchanged UI", async () => {
  const h = await page("options", {
    biliSettings: { home: { preview: false } },
  });
  const input = h.document.querySelector("#import");
  const invalid = {
    ...C.backup(C.normalize({ home: { preview: true } })),
    localBackground: { dataUrl: "javascript:bad" },
  };
  Object.defineProperty(input, "files", {
    value: [{ size: 100, text: async () => JSON.stringify(invalid) }],
  });
  event(h, input, "change");
  await h.settle();
  assert(h.document.querySelector("#status").classList.contains("error"));
  assert.equal(
    h.document.querySelector('[data-key="home.preview"]').checked,
    false,
  );
  h.document.querySelector("#save").click();
  await h.settle();
  assert.equal(
    h.storage.biliSettings.home.preview,
    false,
    "rejected import must not silently replace the config variable",
  );
});
test("QAHS-16 options reject invalid ranges, retry quota by removing only caches, display diagnostics/status, and retain background", async () => {
  const h = await page("options", {
    localBackground: { dataUrl: "data:image/webp;base64,AAAA" },
    "ai:old": {},
    "transcript:old": {},
    diagnostics: [
      {
        at: 1,
        kind: "summary",
        status: "failed",
        error: "TEST_FAILURE",
        elapsedMs: 1200,
      },
    ],
  });
  setInput(h, '[data-key="filter.minDuration"]', "20");
  setInput(h, '[data-key="filter.maxDuration"]', "10");
  h.document.querySelector("#save").click();
  await h.settle();
  assert(h.document.querySelector("#status").textContent.includes("上限"));
  assert.equal(h.storage.biliSettings, undefined);
  setInput(h, '[data-key="filter.maxDuration"]', "30");
  let count = 0;
  const write = h.chrome.storage.local.set;
  h.chrome.storage.local.set = async (v) => {
    if (++count === 1) throw Error("QUOTA_BYTES quota exceeded");
    return write(v);
  };
  h.document.querySelector("#save").click();
  await h.settle();
  assert.equal(count, 2);
  assert.equal(h.storage.biliSettings.filter.minDuration, 20);
  assert(h.storage.localBackground);
  assert.equal(h.storage["ai:old"], undefined);
  assert.equal(h.storage["transcript:old"], undefined);
  assert(
    h.document
      .querySelector("#diagnostics")
      .textContent.includes("TEST_FAILURE"),
  );
  h.document.querySelector("#check").click();
  await h.settle();
  assert(
    h.document.querySelector("#connection").textContent.includes("转写已就绪"),
  );
  h.storage["ai:new"] = {};
  h.document.querySelector("#clear-cache").click();
  await h.settle();
  assert.equal(h.storage["ai:new"], undefined);
  assert(h.storage.localBackground);
  assert(h.storage.biliSettings);
});
test("QAHS-17 background validation rejects unsafe/oversized data and prepareImage enforces input and decoded size limits", async () => {
  const h = harness();
  const UI = h.context.BiliUI;
  for (const dataUrl of [
    "data:text/html;base64,AAAA",
    "data:image/svg+xml;base64,AAAA",
    "data:image/png;base64," + "A".repeat(3 * 1024 * 1024),
  ])
    assert.throws(() => UI.validateBackground({ dataUrl }), /格式/);
  for (const file of [
    { type: "image/gif", size: 1 },
    { type: "image/png", size: 17 * 1024 * 1024 },
  ])
    await assert.rejects(UI.prepareImage(file), /16MB/);
  h.context.Image = class {
    naturalWidth = 10000;
    naturalHeight = 5000;
    decode() {
      return Promise.resolve();
    }
  };
  await assert.rejects(
    UI.prepareImage({ type: "image/png", size: 100, name: "big.png" }),
    /尺寸/,
  );
});
test("QAHS-18 system theme follows media and daily note is deterministic, with disabled quote truly empty", async () => {
  const h = harness();
  h.setDark(true);
  h.context.BiliUI.applyTheme(h.document, h.context.BiliConfig.normalize());
  assert.equal(h.document.documentElement.getAttribute("data-theme"), "dark");
  h.setDark(false);
  h.context.BiliUI.applyTheme(h.document, h.context.BiliConfig.normalize());
  assert.equal(h.document.documentElement.getAttribute("data-theme"), "light");
  const note = h.context.BiliUI.dailyNote(new Date(2026, 9, 28, 9));
  assert.equal(note, h.context.BiliUI.dailyNote(new Date(2026, 9, 28, 18)));
  const p = await page("popup", {
    biliSettings: { appearance: { dailyQuoteEnabled: false } },
  });
  assert.equal(p.document.querySelector("#quote").textContent, "");
});
test("QAHS-19 background image preparation scales a valid decoded image and stores WebP data", async () => {
  const h = harness();
  h.context.Image = class {
    naturalWidth = 4000;
    naturalHeight = 3000;
    decode() {
      return Promise.resolve();
    }
  };
  const create = h.document.createElement;
  const draws = [];
  h.document.createElement = (tag, ...args) =>
    tag === "canvas"
      ? {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage: (...values) => draws.push(values) }),
          toDataURL: (mime, quality) => {
            assert.equal(mime, "image/webp");
            assert.equal(quality, 0.86);
            return "data:image/webp;base64,AAAA";
          },
        }
      : create(tag, ...args);
  const result = await h.context.BiliUI.prepareImage({
    type: "image/png",
    size: 1500,
    name: "photo.png",
  });
  assert.equal(result.width, 1600);
  assert.equal(result.height, 1200);
  assert.equal(result.type, "image/webp");
  assert.equal(result.name, "photo.png");
  assert.equal(draws.length, 1);
  assert.equal(draws[0][3], 1600);
  assert.equal(draws[0][4], 1200);
});
test("QAHS-20 maintenance and popup connection failures display errors and re-enable controls", async () => {
  const h = await page("options");
  h.chrome.runtime.sendMessage = async () => ({
    ok: false,
    error: "QA bridge unavailable",
  });
  h.document.querySelector("#check").click();
  await h.settle();
  assert.equal(
    h.document.querySelector("#connection").textContent,
    "QA bridge unavailable",
  );
  assert.equal(h.document.querySelector("#check").disabled, false);
  const popup = await page("popup");
  popup.chrome.runtime.sendMessage = async () => {
    throw Error("offline");
  };
  popup.document.querySelector("#check").click();
  await popup.settle();
  assert(
    popup.document.querySelector("#status").textContent.includes("连接失败"),
  );
  assert.equal(popup.document.querySelector("#check").disabled, false);
  popup.chrome.tabs.sendMessage = async () => {
    throw Error("No receiver");
  };
  popup.document.querySelector("#show").click();
  await popup.settle();
  assert(
    popup.document.querySelector("#status").textContent.includes("刷新页面"),
  );
  assert.equal(popup.closed(), 0);
});
test("QAHS-21 options dirty guard tracks edit/save and a disabled quote and saved favorite carry into popup", async () => {
  const h = await page("options");
  const before = new h.window.Event("beforeunload", { cancelable: true });
  h.window.dispatchEvent(before);
  assert(!before.defaultPrevented);
  setInput(h, '[data-key="home.preview"]', true, "change");
  setInput(h, '[data-key="appearance.dailyQuoteEnabled"]', false, "change");
  h.document.querySelector('[data-favorite="home.preview"]').click();
  const dirty = new h.window.Event("beforeunload", { cancelable: true });
  h.window.dispatchEvent(dirty);
  assert(dirty.defaultPrevented);
  h.document.querySelector("#save").click();
  await h.settle();
  const saved = new h.window.Event("beforeunload", { cancelable: true });
  h.window.dispatchEvent(saved);
  assert(!saved.defaultPrevented);
  const popup = await page("popup", h.storage);
  assert.equal(popup.document.querySelector("#quote").textContent, "");
  assert.equal(
    popup.document.querySelector('#favorites input[aria-label="极速预览"]')
      .checked,
    true,
  );
});
async function indexedHome() {
  const wrap = (n, title) => `<div class="feed-card">${card(n, title)}</div>`;
  const h = harness(
    `<section class="recommended-container_floor-aside"><div class="container is-version8">${wrap(1, "首批")}</div><button class="feed-roll-btn">换一换</button></section>`,
    { biliSettings: { home: { history: true } } },
  );
  h.load("features/home.js");
  h.load("features/index.js");
  await h.settle();
  const grid = h.document.querySelector(".container");
  event(h, h.window, "bili-codex-data", {
    detail: JSON.stringify({ homeFeed: { phase: "request" } }),
  });
  grid.innerHTML = wrap(2, "第二批");
  event(h, h.window, "bili-codex-data", {
    detail: JSON.stringify({ homeFeed: { phase: "response" } }),
  });
  h.advance(200);
  await h.settle();
  assert.equal(h.context.BiliFeatures.context.history.count, 2);
  return h;
}
test("QAHS-22 actual index route exit removes history UI and restores native nodes from a selected historical batch", async () => {
  const h = await indexedHome(),
    grid = h.document.querySelector(".container"),
    native = grid.children[0];
  h.document
    .querySelector('[data-bcx-widget="history"]')
    .shadowRoot.querySelector("button")
    .click();
  assert.equal(grid.querySelector(".title").textContent, "首批");
  h.location.pathname = "/video/" + bv(2) + "/";
  h.location.href = "https://www.bilibili.com" + h.location.pathname;
  h.advance(1200);
  await h.settle();
  assert(!h.document.querySelector('[data-bcx-widget="history"]'));
  assert(
    grid.children[0] === native,
    "route cleanup restores the existing native card",
  );
  assert.equal(grid.querySelector(".title").textContent, "第二批");
});
test("QAHS-23 changing only popup appearance must not discard the current homepage history session", async () => {
  const h = await indexedHome();
  h.context.BiliFeatures.context.patch("appearance.theme", "dark");
  await h.settle();
  assert.equal(
    h.context.BiliFeatures.context.history.count,
    2,
    "unrelated appearance change cannot clear the active home history",
  );
});
test("QAHS-24 local provider is the account-free default, backups retain selected models, and invalid providers never become Codex", () => {
  const defaults = C.normalize();
  assert.equal(defaults.ai.provider, "local");
  assert.equal(defaults.ai.localModel, "qwen3:4b");
  for (const provider of ["local", "codex"])
    for (const localModel of ["qwen3:1.7b", "qwen3:4b", "qwen3:8b"]) {
      const value = C.normalize({ ai: { provider, localModel } });
      assert.deepEqual(C.restore(C.backup(value)), value);
    }
  assert.throws(() => C.normalize({ ai: { provider: "invalid" } }), /模型服务/);
  assert.throws(
    () =>
      C.restore({
        ...C.backup(defaults),
        settings: { ai: { provider: "not-available" } },
      }),
    /模型服务/,
  );
  assert.throws(
    () => C.normalize({ ai: { localModel: "untrusted:model" } }),
    /本机模型/,
  );
  const legacy = C.restore({
    format: "bilibili-codex-settings",
    version: 2,
    settings: { home: { preview: true } },
  });
  assert.equal(legacy.ai.provider, "local");
  assert.equal(legacy.ai.localModel, "qwen3:4b");
  assert.equal(legacy.home.preview, true);
});
test("QAHS-25 setup defaults explain the download and never mark missing runtime/model information as ready", async () => {
  const h = await page("options");
  assert.equal(
    h.document.querySelector('[data-key="ai.provider"]').value,
    "local",
  );
  assert.equal(
    h.document.querySelector('[data-key="ai.localModel"]').value,
    "qwen3:4b",
  );
  assert(
    h.document
      .querySelector("#model-provider-note")
      .textContent.includes("无需注册或登录"),
  );
  assert(
    h.document
      .querySelector("#model-provider-note")
      .textContent.includes("2.5GB"),
  );
  assert.equal(h.document.querySelector("#model-setup-controls").hidden, false);
  assert(
    h.document
      .querySelector("#model-setup-status")
      .textContent.includes("尚未检查"),
  );
  h.document.querySelector("#model-setup-check").click();
  await h.settle();
  assert(
    h.document
      .querySelector("#model-setup-status")
      .textContent.includes("尚未确认"),
  );
  assert(
    !h.document
      .querySelector("#model-setup-status")
      .textContent.includes("模型 qwen3:4b 已就绪"),
  );
  assert.deepEqual(plain(h.messages.at(-1)), {
    type: "check",
    provider: "local",
    model: "qwen3:4b",
  });
});
test("QAHS-26 model preparation uses the requested port, validates progress, and saves only provider/model on a matching ready result", async () => {
  const h = await page("options", {
      biliSettings: { home: { preview: false } },
    }),
    ports = modelPort(h);
  setInput(h, '[data-key="home.preview"]', true, "change");
  setInput(h, '[data-key="ai.localModel"]', "qwen3:1.7b");
  h.document.querySelector("#model-setup-start").click();
  assert.equal(ports.length, 1);
  const p = ports[0];
  assert.equal(p.options.name, "bili-model-setup");
  assert.equal(p.posts[0].type, "setup-local-model");
  assert.equal(p.posts[0].model, "qwen3:1.7b");
  assert.equal(typeof p.posts[0].id, "string");
  assert(p.posts[0].id.length > 5);
  assert.equal(
    h.document.querySelector('[data-key="ai.provider"]').disabled,
    true,
  );
  assert.equal(
    h.document.querySelector('[data-key="ai.localModel"]').disabled,
    true,
  );
  await p.fire({
    type: "progress",
    stage: "download",
    status: "正在下载模型",
    completed: 25,
    total: 100,
  });
  assert.equal(h.document.querySelector("#model-setup-progress").value, 25);
  assert(
    h.document.querySelector("#model-setup-status").textContent.includes("25%"),
  );
  await p.fire({
    type: "result",
    result: { ready: true, model: "qwen3:1.7b" },
  });
  await h.settle();
  assert.equal(h.storage.biliSettings.ai.provider, "local");
  assert.equal(h.storage.biliSettings.ai.localModel, "qwen3:1.7b");
  assert.equal(
    h.storage.biliSettings.home.preview,
    false,
    "unrelated unsaved edits are not silently persisted",
  );
  assert.equal(
    h.document.querySelector('[data-key="home.preview"]').checked,
    true,
  );
  assert(h.document.querySelector("#status").textContent.includes("其他修改"));
  assert(
    h.document
      .querySelector("#model-setup-status")
      .textContent.includes("已就绪并已配置"),
  );
  assert.equal(p.disconnected, true);
  assert.equal(h.document.querySelector("#model-setup-start").disabled, false);
  h.document.querySelector("#save").click();
  await h.settle();
  assert.equal(h.storage.biliSettings.home.preview, true);
});
test("QAHS-27 cancellation sends the same task id, disconnects, and ignores late ready results without changing provider/model", async () => {
  const h = await page("options"),
    ports = modelPort(h);
  setInput(h, '[data-key="ai.localModel"]', "qwen3:8b");
  h.document.querySelector("#model-setup-start").click();
  const p = ports[0];
  h.document.querySelector("#model-setup-cancel").click();
  assert.deepEqual(p.posts[1], { type: "cancel", id: p.posts[0].id });
  assert.equal(p.disconnected, true);
  assert(
    h.document
      .querySelector("#model-setup-status")
      .textContent.includes("已取消"),
  );
  await p.fire({ type: "result", result: { ready: true, model: "qwen3:8b" } });
  await h.settle();
  assert.equal(h.storage.biliSettings, undefined);
  assert.equal(
    h.document.querySelector('[data-key="ai.provider"]').value,
    "local",
  );
  assert.equal(h.document.querySelector("#model-setup-start").disabled, false);
});
test("QAHS-28 malformed progress, unknown protocol, mismatched results and native errors are visible and never saved as success", async () => {
  const cases = [
    { type: "progress", percent: 101 },
    { type: "progress" },
    { type: "unknown" },
    { type: "result", result: { ready: true, model: "qwen3:8b" } },
    { type: "result", result: { ready: false, model: "qwen3:4b" } },
    { type: "error", error: "QA_MODEL_FAILURE" },
  ];
  for (const packet of cases) {
    const h = await page("options"),
      ports = modelPort(h);
    h.document.querySelector("#model-setup-start").click();
    await ports[0].fire(packet);
    await h.settle();
    assert(
      h.document
        .querySelector("#model-setup-status")
        .classList.contains("error"),
      JSON.stringify(packet),
    );
    assert.equal(h.storage.biliSettings, undefined);
    assert.equal(
      h.document.querySelector("#model-setup-start").disabled,
      false,
    );
    assert.equal(ports[0].disconnected, true);
  }
});
test("QAHS-29 unexpected disconnect is reported, stale task ids are ignored, and model progress is rendered as safe text", async () => {
  const h = await page("options"),
    ports = modelPort(h);
  h.document.querySelector("#model-setup-start").click();
  const p = ports[0];
  await p.fire({
    type: "result",
    id: "old-task",
    result: { ready: true, model: "qwen3:4b" },
  });
  assert.equal(h.storage.biliSettings, undefined);
  assert.equal(h.document.querySelector("#model-setup-start").disabled, true);
  await p.fire({
    type: "progress",
    status: '<img src=x onerror="bad()">',
    percent: 50,
  });
  assert(!h.document.querySelector("#model-setup-status img"));
  assert(
    h.document
      .querySelector("#model-setup-status")
      .textContent.includes("<img"),
  );
  p.disconnect();
  assert(
    h.document
      .querySelector("#model-setup-status")
      .textContent.includes("连接已断开"),
  );
  assert.equal(h.document.querySelector("#model-setup-start").disabled, false);
  h.document.querySelector("#model-setup-start").click();
  assert.equal(ports.length, 2);
  assert.notEqual(ports[1].posts[0].id, p.posts[0].id);
});
test("QAHS-30 local readiness is strict, selected Codex is explicit, and stale status checks cannot certify a newly selected model", async () => {
  const h = await page("options");
  const cases = [
    [
      {
        ok: true,
        provider: "local",
        localRuntimeReady: true,
        localModelReady: true,
        localModel: "qwen3:4b",
      },
      "模型 qwen3:4b 已就绪",
    ],
    [
      { ok: true, provider: "local", localRuntimeReady: false },
      "运行环境尚未准备",
    ],
    [
      {
        ok: true,
        provider: "local",
        localRuntimeReady: true,
        localModelReady: false,
      },
      "模型尚未准备",
    ],
    [{ ok: true, provider: "codex" }, "服务与当前选择不同"],
    [
      {
        ok: true,
        provider: "local",
        localRuntimeReady: "true",
        localModelReady: true,
        localModel: "qwen3:4b",
      },
      "尚未确认",
    ],
  ];
  for (const [result, expected] of cases) {
    h.chrome.runtime.sendMessage = async () => result;
    h.document.querySelector("#model-setup-check").click();
    await h.settle();
    assert(
      h.document
        .querySelector("#model-setup-status")
        .textContent.includes(expected),
      expected,
    );
  }
  let resolve;
  h.chrome.runtime.sendMessage = () => new Promise((r) => (resolve = r));
  h.document.querySelector("#model-setup-check").click();
  setInput(h, '[data-key="ai.localModel"]', "qwen3:1.7b");
  resolve(cases[0][0]);
  await h.settle();
  assert(
    h.document
      .querySelector("#model-setup-status")
      .textContent.includes("选择已变更"),
  );
  setInput(h, '[data-key="ai.provider"]', "codex");
  assert.equal(h.document.querySelector("#model-setup-controls").hidden, true);
  assert.equal(
    h.document.querySelector('[data-key="ai.localModel"]').closest(".field")
      .hidden,
    true,
  );
  assert(
    h.document
      .querySelector("#model-provider-note")
      .textContent.includes("需要账号"),
  );
  const ports = modelPort(h);
  h.document.querySelector("#model-setup-start").click();
  assert.equal(
    ports.length,
    0,
    "hidden local setup does not run in Codex mode",
  );
});
test("QAHS-31 reset, valid import and page exit cancel active preparation, while rejected import leaves state and task untouched", async () => {
  for (const action of ["reset", "import", "pagehide"]) {
    const h = await page("options"),
      ports = modelPort(h);
    h.document.querySelector("#model-setup-start").click();
    if (action === "reset") h.document.querySelector("#reset").click();
    else if (action === "pagehide") event(h, h.window, "pagehide");
    else {
      const input = h.document.querySelector("#import");
      Object.defineProperty(input, "files", {
        value: [
          {
            size: 10,
            text: async () => JSON.stringify(C.backup(C.normalize())),
          },
        ],
      });
      event(h, input, "change");
      await h.settle();
    }
    assert.equal(ports[0].posts[1].type, "cancel", action);
    assert.equal(ports[0].disconnected, true, action);
  }
  const h = await page("options"),
    ports = modelPort(h);
  h.document.querySelector("#model-setup-start").click();
  const input = h.document.querySelector("#import");
  Object.defineProperty(input, "files", {
    value: [
      {
        size: 10,
        text: async () =>
          JSON.stringify({
            ...C.backup(C.normalize({ ai: { provider: "codex" } })),
            localBackground: { dataUrl: "invalid" },
          }),
      },
    ],
  });
  event(h, input, "change");
  await h.settle();
  assert.equal(ports[0].posts.length, 1);
  assert.equal(ports[0].disconnected, false);
  assert.equal(
    h.document.querySelector('[data-key="ai.provider"]').value,
    "local",
  );
  assert(h.document.querySelector("#status").classList.contains("error"));
});
test("QAHS-32 preparation connect/storage failures restore controls and expose the specific recovery without switching to Codex", async () => {
  const offline = await page("options");
  offline.chrome.runtime.connect = () => {
    throw Error("QA_NO_HOST");
  };
  offline.document.querySelector("#model-setup-start").click();
  assert(
    offline.document
      .querySelector("#model-setup-status")
      .textContent.includes("QA_NO_HOST"),
  );
  assert.equal(
    offline.document.querySelector("#model-setup-start").disabled,
    false,
  );
  const h = await page("options"),
    ports = modelPort(h);
  h.chrome.storage.local.set = async () => {
    throw Error("QA_STORAGE_FAILURE");
  };
  h.document.querySelector("#model-setup-start").click();
  await ports[0].fire({
    type: "result",
    result: { ready: true, model: "qwen3:4b" },
  });
  assert(
    h.document
      .querySelector("#model-setup-status")
      .textContent.includes("配置保存失败"),
  );
  assert.equal(
    h.document.querySelector('[data-key="ai.provider"]').value,
    "local",
  );
  assert.equal(h.document.querySelector("#model-setup-start").disabled, false);
});
test("QAHS-33 popup describes the selected provider and only reports actual matching model readiness", async () => {
  const local = await page("popup");
  assert(
    local.document
      .querySelector("#ai-toggle")
      .textContent.includes("本机处理，无需账号"),
  );
  assert(
    !local.document.querySelector("#ai-toggle").textContent.includes("Codex"),
  );
  local.chrome.runtime.sendMessage = async () => ({
    ok: true,
    provider: "local",
    localRuntimeReady: true,
    localModelReady: true,
    localModel: "qwen3:4b",
  });
  local.document.querySelector("#check").click();
  await local.settle();
  assert(
    local.document
      .querySelector("#status")
      .textContent.includes("qwen3:4b 已就绪"),
  );
  const remote = await page("popup", {
    biliSettings: { ai: { provider: "codex" } },
  });
  assert(
    remote.document.querySelector("#ai-toggle").textContent.includes("Codex"),
  );
  remote.chrome.runtime.sendMessage = async () => ({
    ok: true,
    provider: "codex",
  });
  remote.document.querySelector("#check").click();
  await remote.settle();
  assert(
    remote.document
      .querySelector("#status")
      .textContent.includes("Codex 桥接已连接"),
  );
  assert.deepEqual(remote.messages, []);
});
