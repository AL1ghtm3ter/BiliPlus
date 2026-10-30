"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const { parseHTML } = require("linkedom");
const root = path.resolve(
  process.env.BILI_TEST_SOURCE_ROOT || path.join(__dirname, ".."),
  "extension",
);
const feedUrl =
  "https://api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd?fresh_type=3";
const batch = (number) => ({
  code: 0,
  data: {
    item: [0, 1].map((i) => ({
      bvid: "BV" + String(number * 2 + i + 1000000000),
      title: `第${number}批-${i}`,
      goto: "av",
      pic: `https://i0.hdslb.com/${number}-${i}.jpg`,
    })),
  },
});
const flush = () => new Promise(setImmediate);

async function harness({
  transport = "fetch",
  decoyStore = true,
  serverRendered = false,
  visibleCount = 100,
  ads = false,
  nativeWrapper = false,
  infiniteBeforeStart = false,
  startupIndex = false,
} = {}) {
  const { window, document } = parseHTML(
    '<html><head></head><body><div class="recommended-container_floor-aside"><div class="recommended-swipe"><a href="/video/BV9999999999">轮播</a></div><div class="container is-version8"></div><button class="feed-roll-btn">换一换</button></div></body></html>',
  );
  const location = {
    hostname: "www.bilibili.com",
    href: "https://www.bilibili.com/",
    pathname: "/",
    search: "",
  };
  if (nativeWrapper) {
    const old = document.querySelector(".feed-roll-btn"),
      wrapper = document.createElement("div");
    wrapper.className = "feed-roll-btn";
    const real = document.createElement("button");
    real.className = "roll-btn";
    real.textContent = "换一换";
    wrapper.append(real);
    old.replaceWith(wrapper);
  }
  window.location = location;
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return {
      width: this.hidden ? 0 : 300,
      height: this.hidden ? 0 : 200,
      top: 255,
      left: 0,
      right: 300,
      bottom: 455,
    };
  };
  const createElement = document.createElement.bind(document);
  document.createElement = (name, ...args) => {
    const node = createElement(name, ...args);
    if (name === "dialog") {
      node.showModal = () => node.setAttribute("open", "");
      node.close = () => node.dispatchEvent(new window.Event("close"));
    }
    return node;
  };
  const timers = new Map(),
    packets = [],
    nativeFetches = [],
    xhrs = [],
    pendingRenders = [];
  let time = 0,
    serial = 0,
    reply = batch(1),
    freezeRenderer = false;
  const grid = document.querySelector(".container"),
    button = document.querySelector(
      nativeWrapper ? ".roll-btn" : ".feed-roll-btn",
    );
  button.getBoundingClientRect = () => ({
    width: 40,
    height: 30,
    top: 10,
    left: 800,
    bottom: 40,
  });
  const schedule = (fn, delay = 0, repeat = false) => {
    const id = ++serial;
    timers.set(id, { fn, delay, due: time + delay, repeat });
    return id;
  };
  function advance(ms) {
    const until = time + ms;
    let loops = 0;
    while (true) {
      const item = [...timers].sort((a, b) => a[1].due - b[1].due)[0];
      if (!item || item[1].due > until) break;
      assert(++loops < 2000, "bounded timers must settle");
      const [id, t] = item;
      time = t.due;
      if (t.repeat) t.due += t.delay;
      else timers.delete(id);
      t.fn();
    }
    time = until;
  }
  function render(data) {
    const work = () => {
      grid.replaceChildren(
        ...data.data.item
          .filter((item) => item.bvid)
          .slice(0, visibleCount)
          .map((item) => {
            const card = document.createElement("div");
            card.className = "bili-feed-card";
            const inner = document.createElement("div");
            inner.className = "bili-video-card";
            const a = document.createElement("a");
            a.href = "https://www.bilibili.com/video/" + item.bvid;
            a.title = item.title;
            const image = document.createElement("img");
            image.src = item.pic;
            image.alt = item.title;
            const title = document.createElement("h3");
            title.textContent = item.title;
            a.append(image, title);
            inner.append(a);
            if (nativeWrapper) {
              card.className = "feed-card";
              const wrapper = document.createElement("div");
              wrapper.className = "bili-feed-card";
              wrapper.append(inner);
              card.append(wrapper);
            } else card.append(inner);
            return card;
          }),
      );
    };
    freezeRenderer ? pendingRenders.push(work) : work();
  }
  render(batch(1));
  let lower;
  if (infiniteBeforeStart) {
    lower = document.createElement("div");
    lower.className = "bili-feed-card";
    lower.innerHTML =
      '<div class="bili-video-card"><a href="/video/BV9999999998"><h3>下方推荐-1</h3></a></div>';
    grid.append(lower);
  }
  window.__pinia = decoyStore
    ? { feed: { data: { recommend: { item: batch(1).data.item } } } }
    : undefined;
  class XHR {
    constructor() {
      this.listeners = new Map();
      this.responseType = "";
      this.readyState = 0;
      this.status = 0;
      xhrs.push(this);
    }
    open(method, url) {
      this.method = method;
      this.url = String(url);
      this.readyState = 1;
    }
    send() {
      this.body = structuredClone(reply);
      queueMicrotask(() => {
        this.readyState = 4;
        this.status = 200;
        for (const item of [...(this.listeners.get("load") || [])])
          item.call(this);
        this.onload?.();
      });
    }
    addEventListener(type, fn) {
      const list = this.listeners.get(type) || [];
      list.push(fn);
      this.listeners.set(type, list);
    }
    removeEventListener(type, fn) {
      this.listeners.set(
        type,
        (this.listeners.get(type) || []).filter((f) => f !== fn),
      );
    }
    get responseText() {
      return JSON.stringify(this.body);
    }
    get response() {
      return this.responseType === "json" ? this.body : this.responseText;
    }
  }
  window.fetch = function (input, options) {
    nativeFetches.push({ input, options });
    return Promise.resolve(
      new Response(JSON.stringify(reply), {
        headers: { "content-type": "application/json" },
      }),
    );
  };
  const runtime = {
    sendMessage: async () => ({
      ok: true,
      data: { pic: "https://i0.hdslb.com/original.jpg", title: "原始封面" },
    }),
  };
  let restarts = 0;
  window.addEventListener("bili-codex-settings-change", () => restarts++);
  const context = vm.createContext({
    window,
    document,
    location,
    XMLHttpRequest: XHR,
    URL,
    Request,
    Response,
    TextDecoder,
    TextEncoder,
    CustomEvent: window.CustomEvent,
    Event: window.Event,
    chrome: {
      runtime,
      storage: {
        onChanged: { addListener() {} },
        local: {
          get: async () => ({
            biliSettings: { home: { history: true, coverZoom: true } },
          }),
        },
      },
    },
    innerWidth: 1400,
    innerHeight: 900,
    getComputedStyle: () => ({
      position: "static",
      display: "block",
      visibility: "visible",
    }),
    setTimeout: (fn, delay) => schedule(fn, delay),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, delay) => schedule(fn, delay, true),
    clearInterval: (id) => timers.delete(id),
    queueMicrotask,
    console,
  });
  const load = (name) =>
    vm.runInContext(fs.readFileSync(path.join(root, name), "utf8"), context, {
      filename: name,
    });
  load("common/config.js");
  load("features/runtime.js");
  load("features/home.js");
  load("capture.js");
  let state = {
    history: { count: 0, index: -1 },
    details: new Map(),
    videos: new Map(),
    settings: () =>
      context.BiliConfig.normalize({
        home: { history: true, coverZoom: true },
      }),
  };
  window.addEventListener("bili-codex-data", (event) => {
    const data = JSON.parse(event.detail);
    packets.push(data);
    if (data.history) state.history = data.history;
    if (data.videos) for (const v of data.videos) state.videos.set(v.bvid, v);
  });
  let stop = () => {};
  const homeModule = context.BiliFeatures.modules.find(
    (x) => x.name === "home",
  );
  if (startupIndex) {
    const start = homeModule.start;
    homeModule.start = (...args) => (stop = start(...args));
    load("features/index.js");
    await flush();
    state = context.BiliFeatures.context;
  } else stop = homeModule.start(state.settings(), state);
  window.dispatchEvent(
    new window.CustomEvent("bili-codex-config", {
      detail: JSON.stringify({
        history: true,
        historyLimit: 8,
        videoMetadata: true,
      }),
    }),
  );
  async function refresh(url = feedUrl, apply = true) {
    if (transport === "fetch") {
      const data = await (await window.fetch(url)).json();
      if (apply) render(data);
    } else
      await new Promise((resolve) => {
        const xhr = new XHR();
        xhr.responseType = "json";
        xhr.addEventListener("load", () => {
          if (apply) render(xhr.response);
          resolve();
        });
        xhr.open("GET", url);
        xhr.send();
      });
  }
  button.addEventListener("click", () => {
    void refresh();
  });
  const settle = async () => {
    for (let i = 0; i < 8; i++) await flush();
    advance(250);
    for (let i = 0; i < 4; i++) await flush();
    advance(250);
  };
  if (!serverRendered) {
    await refresh();
    await settle();
  }
  return {
    window,
    document,
    context,
    state,
    grid,
    lower,
    button,
    packets,
    nativeFetches,
    xhrs,
    advance,
    restarts: () => restarts,
    settle,
    render,
    refresh,
    setReply: (n) => {
      reply = batch(n);
      if (ads) reply.data.item.splice(0, 0, { goto: "ad", title: "广告" });
    },
    freeze: () => (freezeRenderer = true),
    unfreeze: () => (freezeRenderer = false),
    takeRender: () => pendingRenders.shift(),
    release: () => {
      freezeRenderer = false;
      for (const f of pendingRenders.splice(0)) f();
    },
    stop: () => {
      stop();
      stop = () => {};
    },
    cards: () =>
      [...grid.querySelectorAll(".bili-video-card a")].map((a) => ({
        bvid: a.href.match(/BV\w{10}/)[0],
        title: a.querySelector("h3").textContent,
      })),
    click: (delta) => {
      const host = document.querySelector('[data-bcx-widget="history"]');
      host.shadowRoot.querySelectorAll("button")[delta < 0 ? 0 : 1].click();
    },
  };
}

test("real homepage DIV.feed-roll-btn wrapping BUTTON.roll-btn restores the prior visible cards without waiting for another network batch", async () => {
  const h = await harness({ nativeWrapper: true });
  h.setReply(2);
  await h.refresh();
  await h.settle();
  h.setReply(3);
  await h.refresh();
  await h.settle();
  const calls = h.nativeFetches.length;
  h.click(-1);
  await h.settle();
  h.advance(6000);
  await h.settle();
  assert.equal(
    h.state.history.error || "",
    "",
    "the real native wrapper must not cause a history replay timeout",
  );
  assert.equal(h.cards()[0].title, "第2批-0");
  assert.equal(h.state.history.index, 1);
  assert.equal(h.state.history.error || "", "");
  assert.equal(
    h.nativeFetches.length,
    calls,
    "snapshot navigation needs no synthetic native click or request",
  );
  h.stop();
});

for (const transport of ["fetch", "xhr"])
  test(`history ${transport} stays on the selected batch during background infinite-feed requests`, async () => {
    const h = await harness({ transport, nativeWrapper: true });
    h.setReply(2);
    await h.refresh();
    await h.settle();
    h.setReply(3);
    await h.refresh();
    await h.settle();
    h.click(-1);
    assert.equal(
      h.cards()[0].title,
      "第2批-0",
      "navigation initially changes visible cards",
    );
    h.setReply(4);
    await h.refresh(feedUrl.replace("fresh_type=3", "fresh_type=4"), false);
    await h.settle();
    assert.equal(
      h.cards()[0].title,
      "第2批-0",
      "background recommendation loading must not revert history to the latest batch",
    );
    assert.equal(h.state.history.index, 1);
    assert.equal(h.state.history.count, 3);
    h.advance(10000);
    await h.settle();
    assert.equal(h.cards()[0].title, "第2批-0");
    h.stop();
  });

test("initial same-container infinite cards are not recorded as refresh history or detached on navigation", async () => {
  const h = await harness({
    nativeWrapper: true,
    serverRendered: true,
    infiniteBeforeStart: true,
  });
  await h.settle();
  h.lower.querySelector("h3").textContent = "下方推荐-2";
  await h.settle();
  // A native refresh only patches the top .feed-card slots; the lower feed lives on.
  for (const a of h.grid.querySelectorAll(".feed-card a")) {
    a.href = a.href.replace(/BV\w{10}/, "BV1000000004");
    a.querySelector("h3").textContent = "第2批顶部";
  }
  await h.settle();
  h.click(-1);
  assert.equal(h.grid.querySelector(".feed-card h3").textContent, "第1批-0");
  assert.equal(
    h.lower.isConnected,
    true,
    "lower feed must retain its original node",
  );
  assert.equal(h.lower.querySelector("h3").textContent, "下方推荐-2");
  h.stop();
});

test("real feature index does not reset 2/2 homepage history to 1/1 after a preview player request", async () => {
  const h = await harness({ startupIndex: true });
  h.setReply(2);
  await h.refresh();
  await h.settle();
  assert.equal(h.state.history.count, 2);
  await h.window.fetch(
    "https://api.bilibili.com/x/player/wbi/v2?bvid=BV1000000004&cid=777",
  );
  await h.settle();
  h.advance(1200);
  await h.settle();
  assert.equal(
    h.state.history.count,
    2,
    "homepage preview metadata must not restart all features and clear the history stack to 1/1",
  );
  assert.equal(h.restarts(), 1);
  h.click(-1);
  assert.equal(h.cards()[0].title, "第1批-0");
  h.window.location.pathname = "/video/BV1000000004/";
  await h.window.fetch(
    "https://api.bilibili.com/x/player/wbi/v2?bvid=BV1000000004&cid=888",
  );
  await h.settle();
  h.advance(1200);
  assert.equal(h.restarts(), 2, "actual playback route still reinitializes");
  assert.equal(h.state.currentVideoKey, "BV1000000004:888");
  await h.window.fetch(
    "https://api.bilibili.com/x/player/wbi/v2?bvid=BV1000000004&cid=999",
  );
  await h.settle();
  h.advance(1200);
  assert.equal(
    h.restarts(),
    3,
    "same-page CID changes remain supported on playback pages",
  );
  assert.equal(h.state.currentVideoKey, "BV1000000004:999");
  h.stop();
});

for (const transport of ["fetch", "xhr"])
  test(`homepage ${transport} history changes the native-rendered card BV/title despite an unused Pinia lookalike`, async () => {
    const h = await harness({ transport });
    h.setReply(2);
    await h.refresh();
    await h.settle();
    h.setReply(3);
    await h.refresh();
    await h.settle();
    assert.equal(h.state.history.index, 2);
    const original = h.cards();
    h.setReply(4);
    h.click(-1);
    await h.settle();
    assert.deepEqual(
      h.cards().map((x) => x.title),
      batch(2).data.item.map((x) => x.title),
    );
    assert.notDeepEqual(h.cards(), original);
    assert.equal(h.state.history.index, 1);
    h.click(1);
    await h.settle();
    assert.deepEqual(
      h.cards().map((x) => x.bvid),
      batch(3).data.item.map((x) => x.bvid),
    );
    assert.equal(h.state.history.index, 2);
    assert.equal(
      h.document.querySelector(".recommended-swipe").textContent,
      "轮播",
    );
    h.stop();
  });

test("history snapshots render immediately without driving a frozen native renderer, and normal refresh preserves forward history", async () => {
  const h = await harness();
  h.setReply(2);
  await h.refresh();
  await h.settle();
  h.setReply(3);
  await h.refresh();
  await h.settle();
  h.freeze();
  const calls = h.nativeFetches.length;
  h.click(-1);
  await h.settle();
  assert.equal(h.state.history.index, 1);
  assert.equal(h.cards()[0].title, "第2批-0");
  assert.equal(h.nativeFetches.length, calls);
  assert.equal(h.takeRender(), undefined);
  h.unfreeze();
  h.setReply(4);
  await h.refresh();
  await h.settle();
  assert.equal(h.state.history.count, 4);
  assert.equal(h.state.history.index, 3);
  assert.equal(h.cards()[0].title, "第4批-0");
  h.stop();
});

test("history does not advance or resurrect a removed homepage grid", async () => {
  const h = await harness();
  h.setReply(2);
  await h.refresh();
  await h.settle();
  const calls = h.nativeFetches.length;
  h.grid.remove();
  h.click(-1);
  await h.settle();
  assert.equal(h.state.history.index, 1);
  assert.match(h.state.history.error, /推荐区域|重建/);
  assert.equal(h.nativeFetches.length, calls);
  assert(!h.grid.isConnected);
  h.stop();
});

test("server-rendered first cards replay from a temporary snapshot and restore native nodes before a fresh batch or disable", async () => {
  const h = await harness({ decoyStore: false, serverRendered: true });
  await h.settle();
  const first = h.cards();
  h.setReply(2);
  await h.refresh();
  await h.settle();
  const native = [...h.grid.children];
  assert.equal(h.state.history.count, 2);
  h.click(-1);
  await h.settle();
  assert.deepEqual(h.cards(), first);
  assert.equal(h.state.history.index, 0);
  h.stop();
  assert.deepEqual(
    [...h.grid.children],
    native,
    "disabling restores existing native card nodes, not clones",
  );
});

test("cover zoom uses an icon revealed by hover or keyboard focus and still loads the original cover", async () => {
  const h = await harness();
  h.advance(1500);
  const button = h.document.querySelector("[data-bcx-cover]");
  assert.equal(button.textContent, "");
  assert.equal(button.getAttribute("aria-label"), "查看封面");
  assert(button.querySelector("svg"));
  const css = [...h.document.querySelectorAll("style")]
    .map((x) => x.textContent)
    .join("\n");
  assert.match(css, /:hover/);
  assert.match(css, /:focus-within|:focus-visible/);
  assert.match(css, /opacity:\s*0/);
  button.click();
  await h.settle();
  assert.equal(
    h.document.querySelector("dialog img").getAttribute("src"),
    "https://i0.hdslb.com/original.jpg",
  );
  h.stop();
});

test("history verifies only the managed top cards when the native renderer shows a prefix and payload contains an ad without BV", async () => {
  const h = await harness({ visibleCount: 1, ads: true });
  h.setReply(2);
  await h.refresh();
  await h.settle();
  h.setReply(3);
  await h.refresh();
  await h.settle();
  const below = h.document.createElement("div");
  below.className = "infinite-feed";
  below.innerHTML =
    '<div class="bili-feed-card"><a href="/video/BV9999999998">下方无限流</a></div>';
  h.document.body.append(below);
  h.click(-1);
  await h.settle();
  assert.equal(h.state.history.index, 1);
  assert.equal(h.cards()[0].title, "第2批-0");
  assert.equal(below.textContent, "下方无限流");
  h.stop();
});

test("stable homepage scans emit no duplicate packets and snapshot navigation injects no delayed response", async () => {
  const h = await harness();
  h.setReply(2);
  await h.refresh();
  await h.settle();
  const packets = h.packets.length;
  h.advance(10000);
  await h.settle();
  assert.equal(h.packets.length, packets);
  const calls = h.nativeFetches.length;
  h.freeze();
  h.click(-1);
  await h.settle();
  assert.equal(h.takeRender(), undefined);
  assert.equal(h.nativeFetches.length, calls);
  h.unfreeze();
  h.setReply(3);
  await h.refresh();
  await h.settle();
  assert.equal(h.cards()[0].title, "第3批-0");
  assert.equal(h.state.history.index, 2);
  h.stop();
});

test("snapshot freezes loaded currentSrc and resolves lazy picture sources so restored thumbnails do not become placeholders", async () => {
  const h = await harness();
  for (const [index, image] of [...h.grid.querySelectorAll("img")].entries()) {
    const picture = h.document.createElement("picture"),
      source = h.document.createElement("source");
    source.setAttribute(
      "data-srcset",
      `https://i0.hdslb.com/lazy-${index}.avif 1x`,
    );
    image.replaceWith(picture);
    picture.append(source, image);
    image.setAttribute("src", "data:image/gif;base64,R0lGODlhAQABAAAAACw=");
    image.setAttribute("data-src", `https://i0.hdslb.com/lazy-${index}.jpg`);
    if (!index)
      Object.defineProperty(image, "currentSrc", {
        value: "https://i0.hdslb.com/loaded-selected.webp",
      });
  }
  await h.settle();
  h.setReply(2);
  await h.refresh();
  await h.settle();
  h.click(-1);
  await h.settle();
  const pictures = [...h.grid.querySelectorAll("picture")];
  assert.equal(
    pictures[0].querySelector("img").getAttribute("src"),
    "https://i0.hdslb.com/loaded-selected.webp",
  );
  assert.equal(
    pictures[0].querySelector("source").getAttribute("srcset"),
    null,
  );
  assert.equal(
    pictures[1].querySelector("img").getAttribute("src"),
    "https://i0.hdslb.com/lazy-1.jpg",
  );
  assert.equal(
    pictures[1].querySelector("source").getAttribute("srcset"),
    "https://i0.hdslb.com/lazy-1.avif 1x",
  );
  h.stop();
});

test("cover action leaves the native top-right watch-later control unobstructed and preserves its handler", async () => {
  const h = await harness(),
    card = h.grid.querySelector(".bili-video-card");
  const native = h.document.createElement("button");
  native.className = "bili-watch-later--wrap";
  native.textContent = "稍后再看";
  native.style.cssText =
    "position:absolute;top:8px;right:8px;width:28px;height:28px;z-index:9";
  let clicked = 0;
  native.addEventListener("click", () => clicked++);
  card.append(native);
  const before = native.style.cssText;
  h.advance(1500);
  await h.settle();
  const cover = card.querySelector("[data-bcx-cover]");
  function rect(node, width) {
    const style = node.style,
      w = parseFloat(style.width),
      height = parseFloat(style.height);
    const x =
      style.left && style.left !== "auto"
        ? parseFloat(style.left)
        : width - parseFloat(style.right) - w;
    const y = parseFloat(style.top);
    return { x, y, right: x + w, bottom: y + height };
  }
  for (const width of [180, 300, 480]) {
    const a = rect(native, width),
      b = rect(cover, width);
    assert(
      !(a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom),
      "cover must not occupy the native watch-later hit target at card width " +
        width,
    );
  }
  assert.equal(card.querySelector(".bili-watch-later--wrap"), native);
  assert.equal(native.style.cssText, before);
  native.click();
  assert.equal(clicked, 1);
  cover.click();
  await h.settle();
  assert.equal(clicked, 1, "cover action must not activate watch-later");
  assert(
    h.document.querySelector("dialog[open]"),
    "cover action remains functional",
  );
  h.stop();
  assert(native.isConnected);
  assert.equal(native.style.cssText, before);
  native.click();
  assert.equal(clicked, 2);
});

test("real nested feed-card wrappers exclude hidden cards and preserve appended infinite-feed cards in the same container", async () => {
  const h = await harness({ nativeWrapper: true });
  h.setReply(2);
  await h.refresh();
  await h.settle();
  const hidden = h.grid.children[0].cloneNode(true);
  hidden.hidden = true;
  hidden.querySelector("h3").textContent = "隐藏缓存";
  h.grid.prepend(hidden);
  const infinite = h.grid.children[1].cloneNode(true);
  infinite.dataset.infinite = "true";
  infinite.querySelector("h3").textContent = "追加无限流";
  infinite.querySelector("a").href =
    "https://www.bilibili.com/video/BV9999999998";
  h.grid.append(infinite);
  await h.settle();
  assert.equal(h.state.history.count, 2);
  h.click(-1);
  await h.settle();
  const managed = [...h.grid.querySelectorAll(".bili-video-card")].filter(
    (card) => !card.closest("[hidden],[data-infinite]"),
  );
  assert.deepEqual(
    managed.map((card) => card.querySelector("h3").textContent),
    ["第1批-0", "第1批-1"],
  );
  assert(hidden.isConnected);
  assert(infinite.isConnected);
  assert.equal(infinite.querySelector("h3").textContent, "追加无限流");
  h.stop();
  assert(hidden.isConnected);
  assert(infinite.isConnected);
});
