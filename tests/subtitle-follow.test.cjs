"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  crypto = require("node:crypto");
const { parseHTML } = require("linkedom");
const root = path.resolve(
  process.env.BILI_TEST_SOURCE_ROOT || path.join(__dirname, ".."),
);
const flush = () => new Promise(setImmediate);
function event() {
  const listeners = [];
  return {
    addListener: (f) => listeners.push(f),
    fire: (...args) => listeners.map((f) => f(...args)),
  };
}
function trackedMedia(node) {
  const add = node.addEventListener.bind(node),
    remove = node.removeEventListener.bind(node);
  node.listeners = new Map();
  node.addEventListener = (type, fn, options) => {
    if (!node.listeners.has(type)) node.listeners.set(type, new Set());
    node.listeners.get(type).add(fn);
    add(type, fn, options);
  };
  node.removeEventListener = (type, fn, options) => {
    node.listeners.get(type)?.delete(fn);
    remove(type, fn, options);
  };
  node.duration = 1011;
  node.currentTime = 0;
  node.paused = true;
  node.playCalls = 0;
  node.play = () => {
    node.playCalls++;
    node.paused = false;
    return Promise.resolve();
  };
  return node;
}
async function boot() {
  const { window, document } = parseHTML(
    '<!doctype html><html><head></head><body><h1>字幕同步样本</h1><div id="playerWrap"><video></video></div><aside class="right-container"><div class="right-container-inner"><div class="up-panel-container">UP</div><div id="danmukuBox">弹幕</div></div></aside></body></html>',
  );
  document.readyState = "complete";
  const location = {
    hostname: "www.bilibili.com",
    pathname: "/video/BV1ph4y1c7kp/",
    search: "",
    href: "https://www.bilibili.com/video/BV1ph4y1c7kp/",
  };
  window.location = location;
  window.innerHeight = 900;
  window.scrollY = 240;
  document.documentElement.scrollTop = 240;
  window.scrollTo = () =>
    assert.fail("subtitle following must not scroll the outer window");
  window.HTMLElement.prototype.scrollIntoView = () =>
    assert.fail("subtitle following must not call scrollIntoView");
  let video = trackedMedia(document.querySelector("video"));
  const timers = new Map(),
    ports = [],
    store = { biliSettings: { ai: { enabled: true } } };
  let now = 100000,
    serial = 0;
  class ClockDate extends Date {
    static now() {
      return now;
    }
  }
  const schedule = (fn, delay = 0, repeat = false) => {
    const id = ++serial;
    timers.set(id, { fn, due: now + delay, delay, repeat });
    return id;
  };
  const advance = (ms) => {
    const end = now + ms;
    let calls = 0;
    while (true) {
      const next = [...timers].sort((a, b) => a[1].due - b[1].due)[0];
      if (!next || next[1].due > end) break;
      assert(++calls < 10000, "virtual timer loop must be bounded");
      const [id, t] = next;
      now = t.due;
      if (t.repeat) t.due += t.delay;
      else timers.delete(id);
      t.fn();
    }
    now = end;
  };
  const chrome = {
    runtime: {
      getURL: (p) => "chrome-extension://test/" + p,
      onMessage: event(),
      sendMessage: async () => ({}),
      connect: () => {
        const port = {
          onMessage: event(),
          onDisconnect: event(),
          sent: [],
          postMessage: (m) => port.sent.push(m),
          disconnect: () => {
            port.disconnected = true;
            port.onDisconnect.fire();
          },
        };
        ports.push(port);
        return port;
      },
    },
    storage: {
      onChanged: event(),
      local: {
        get: async (key) => (key ? { [key]: store[key] } : { ...store }),
        set: async (v) => Object.assign(store, v),
        remove: async (key) => delete store[key],
      },
    },
  };
  const context = vm.createContext({
    window,
    top: window,
    document,
    location,
    chrome,
    crypto: crypto.webcrypto,
    Date: ClockDate,
    URL,
    CustomEvent: window.CustomEvent,
    Event: window.Event,
    navigator: {},
    console,
    setTimeout: (f, d) => schedule(f, d),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (f, d) => schedule(f, d, true),
    clearInterval: (id) => timers.delete(id),
    requestAnimationFrame: (f) => schedule(f, 16),
    cancelAnimationFrame: (id) => timers.delete(id),
  });
  for (const file of [
    "common/config.js",
    "features/runtime.js",
    "features/index.js",
  ])
    vm.runInContext(
      fs.readFileSync(path.join(root, "extension", file), "utf8"),
      context,
      { filename: file },
    );
  await flush();
  window.addEventListener("bili-codex-request", (e) =>
    window.dispatchEvent(
      new window.CustomEvent("bili-codex-snapshot", {
        detail: JSON.stringify({
          id: JSON.parse(e.detail).id,
          bvid: location.pathname.match(/BV\w{10}/)?.[0],
          cid: "1",
          title: "字幕同步样本",
          duration: video.duration,
        }),
      }),
    ),
  );
  vm.runInContext(
    fs.readFileSync(path.join(root, "extension/content.js"), "utf8"),
    context,
    { filename: "content.js" },
  );
  const host = document.querySelector("#bili-codex-root"),
    shadow = host.shadowRoot;
  const $ = (s) => shadow.querySelector(s),
    rows = () => [...shadow.querySelectorAll(".subtitle-line")];
  const list = $(".transcript");
  list.scrollTop = 0;
  Object.defineProperties(list, {
    clientHeight: { configurable: true, value: 200 },
    scrollHeight: { configurable: true, get: () => rows().length * 40 },
  });
  list.getBoundingClientRect = () => ({
    top: 100,
    bottom: 300,
    height: 200,
    left: 0,
    right: 400,
    width: 400,
  });
  const geometry = () =>
    rows().forEach((row, i) => {
      Object.defineProperties(row, {
        offsetTop: { configurable: true, value: i * 40 },
        offsetHeight: { configurable: true, value: 40 },
        clientHeight: { configurable: true, value: 40 },
      });
      row.getBoundingClientRect = () => ({
        top: 100 + i * 40 - list.scrollTop,
        bottom: 140 + i * 40 - list.scrollTop,
        height: 40,
        left: 0,
        right: 400,
        width: 400,
      });
    });
  const subtitles = Array.from({ length: 337 }, (_, i) => ({
    start: i * 3,
    end: i * 3 + 2,
    text:
      i === 336 ? "最后第337条 <img onerror=bad()>" : "字幕第" + (i + 1) + "条",
  }));
  const load = async () => {
    $(".read").click();
    await flush();
    const port = ports.at(-1),
      request = port.sent.find((m) => m.type === "subtitles");
    assert(request, "subtitle request reaches the simulated NativePort");
    port.onMessage.fire({
      id: request.id,
      type: "result",
      meta: { kind: "subtitles", subtitleCount: subtitles.length },
      result: {
        bvid: "BV1ph4y1c7kp",
        cid: "1",
        source: "official",
        language: "中文",
        duration: 1011,
        subtitles,
      },
    });
    geometry();
  };
  const time = (value, type = "timeupdate", media = video) => {
    media.currentTime = value;
    media.dispatchEvent(new window.Event(type));
  };
  const active = () =>
    rows().filter((row) => row.getAttribute("aria-current") === "true");
  const user = (type, properties = {}) => {
    const e = new window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, properties);
    list.dispatchEvent(e);
    return e;
  };
  const replaceVideo = () => {
    const next = trackedMedia(document.createElement("video"));
    video.replaceWith(next);
    const old = video;
    video = next;
    return { old, next };
  };
  return {
    window,
    document,
    context,
    location,
    host,
    shadow,
    $,
    rows,
    list,
    subtitles,
    ports,
    advance,
    load,
    time,
    active,
    user,
    replaceVideo,
    video: () => video,
  };
}
test("337 complete subtitles render as safe full-row buttons, including the final line, inside a bounded reader", async () => {
  const h = await boot();
  const height = h.host.style.getPropertyValue("--bcx-panel-height");
  await h.load();
  assert.equal(h.rows().length, 337);
  assert.equal(h.rows()[336].tagName, "BUTTON");
  assert.equal(h.rows()[336].getAttribute("type"), "button");
  assert(h.rows()[336].querySelector(".subtitle-time"));
  assert.match(h.rows()[336].lastElementChild.textContent, /最后第337条/);
  assert.equal(
    h.rows()[336].querySelector("img"),
    null,
    "subtitle text is not HTML",
  );
  assert.doesNotMatch(h.$(".transcript-meta").textContent, /预览前|200条/);
  assert.equal(h.host.style.getPropertyValue("--bcx-panel-height"), height);
  const css = fs.readFileSync(path.join(root, "extension/panel.css"), "utf8");
  assert.match(css, /\.transcript,\s*\.chat-log\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(css, /overscroll-behavior:\s*contain/);
});
test("clicking subtitle body seeks the full-row start without calling play or changing paused state", async () => {
  const h = await boot();
  await h.load();
  const row = h.rows()[42];
  const text = row.lastElementChild;
  text.dispatchEvent(new h.window.Event("click", { bubbles: true }));
  assert.equal(h.video().currentTime, 126);
  assert.equal(h.video().paused, true);
  assert.equal(h.video().playCalls, 0);
});
test("timeupdate and seeked select exactly the active half-open cue, including cue indices over 200", async () => {
  const h = await boot();
  await h.load();
  for (const [time, index, type] of [
    [0, 0, "timeupdate"],
    [629, -1, "timeupdate"],
    [630.5, 210, "timeupdate"],
    [1009.9, 336, "seeked"],
    [1, 0, "seeked"],
    [2, -1, "seeked"],
  ]) {
    h.time(time, type);
    assert.equal(
      h.active().length,
      index < 0 ? 0 : 1,
      "active cue count at " + time,
    );
    if (index >= 0) assert.equal(h.active()[0], h.rows()[index]);
  }
  const css = fs.readFileSync(path.join(root, "extension/panel.css"), "utf8");
  assert.match(
    css,
    /\.subtitle-line\[aria-current[=\s"']+true["']?\][^{]*\{[^}]*(?:var\(--brand\)|#ff6699|#f69\b)/,
    "current cue has the pink brand treatment",
  );
});
function assertInsideReader(h, index) {
  const row = h.rows()[index],
    rect = row.getBoundingClientRect(),
    frame = h.list.getBoundingClientRect();
  assert(
    rect.top >= frame.top && rect.bottom <= frame.bottom,
    "active line " + index + " is inside the subtitle viewport",
  );
  assert.equal(h.window.scrollY, 240);
  assert.equal(h.document.documentElement.scrollTop, 240);
}
test("following scrolls only the transcript, handles backward seek and leaves gaps unhighlighted", async () => {
  const h = await boot();
  await h.load();
  h.video().paused = false;
  h.time(630.5);
  assert.equal(h.active()[0], h.rows()[210]);
  assert(h.list.scrollTop > 0);
  assertInsideReader(h, 210);
  h.video().paused = true;
  h.time(6.5, "seeked");
  assert.equal(h.active()[0], h.rows()[2]);
  assertInsideReader(h, 2);
  const position = h.list.scrollTop;
  h.time(8, "seeked");
  assert.equal(h.active().length, 0);
  assert.equal(
    h.list.scrollTop,
    position,
    "a cue gap must not jump the list to an unrelated row",
  );
  assert.equal(h.video().paused, true);
  assert.equal(h.video().playCalls, 0);
});
for (const [type, properties] of [
  ["wheel", { deltaY: -180 }],
  ["touchstart", {}],
  ["keydown", { key: "PageDown", code: "PageDown" }],
])
  test(`${type} pauses automatic subtitle scrolling for five seconds while the current cue continues highlighting`, async () => {
    const h = await boot();
    await h.load();
    h.time(630.5);
    assertInsideReader(h, 210);
    h.list.scrollTop = 0;
    h.user(type, properties);
    h.time(633.5);
    assert.equal(
      h.active()[0],
      h.rows()[211],
      "manual reading does not freeze the pink current-cue state",
    );
    assert.equal(h.list.scrollTop, 0);
    assert.match(h.$(".follow-subtitle").textContent, /跟随播放/);
    assert.equal(h.$(".follow-subtitle").hidden, false);
    h.advance(4999);
    h.time(636.5);
    assert.equal(h.list.scrollTop, 0, "must not resume before five seconds");
    h.advance(1);
    h.time(639.5);
    assert.equal(h.active()[0], h.rows()[213]);
    assertInsideReader(h, 213);
  });
test("the follow button resumes immediately and returning to subtitles locates the current playback position", async () => {
  const h = await boot();
  await h.load();
  h.time(630.5);
  h.list.scrollTop = 0;
  h.user("wheel", { deltaY: -120 });
  h.time(633.5);
  h.$(".follow-subtitle").click();
  assertInsideReader(h, 211);
  h.$('[data-tab="summary"]').click();
  h.list.scrollTop = 0;
  h.time(900.5, "seeked");
  assert.equal(
    h.list.scrollTop,
    0,
    "the hidden subtitle tab must not change its scroll position",
  );
  h.$('[data-tab="subtitles"]').click();
  assert.equal(h.active()[0], h.rows()[300]);
  assertInsideReader(h, 300);
});
test("replacing the native video detaches old media listeners and route exit removes the new listeners", async () => {
  const h = await boot();
  await h.load();
  const first = h.video();
  const mediaEvents = ["timeupdate", "seeking", "seeked", "loadedmetadata"];
  for (const type of mediaEvents) assert(first.listeners.get(type)?.size > 0);
  const { old, next } = h.replaceVideo();
  next.currentTime = 900.5;
  h.advance(1200);
  for (const type of mediaEvents) {
    assert.equal(old.listeners.get(type)?.size || 0, 0);
    assert(next.listeners.get(type)?.size > 0);
  }
  h.time(900.5, "seeked");
  assert.equal(h.active()[0], h.rows()[300]);
  const scroll = h.list.scrollTop;
  h.time(0.5, "timeupdate", old);
  h.time(0.5, "seeked", old);
  assert.equal(h.active()[0], h.rows()[300]);
  assert.equal(h.list.scrollTop, scroll);
  h.location.pathname = "/";
  h.location.href = "https://www.bilibili.com/";
  h.advance(1200);
  assert.equal(h.host.isConnected, false);
  for (const type of mediaEvents)
    assert.equal(next.listeners.get(type)?.size || 0, 0);
});
test("a collapsed reader tracks the current cue without scrolling and recenters when expanded", async () => {
  const h = await boot();
  await h.load();
  h.time(630.5);
  h.$(".collapse").click();
  assert(h.host.hasAttribute("data-collapsed"));
  h.list.scrollTop = 0;
  h.time(900.5, "seeked");
  assert.equal(h.active()[0], h.rows()[300]);
  assert.equal(h.list.scrollTop, 0, "collapsed subtitles must not scroll");
  h.$(".collapse").click();
  assert.equal(h.host.hasAttribute("data-collapsed"), false);
  assertInsideReader(h, 300);
});
test("subtitle rows preserve native button keyboard semantics and keyboard-style click uses the same seek path", async () => {
  const h = await boot();
  await h.load();
  let leakedKeys = 0;
  h.$(".subtitle-pane").addEventListener("keydown", () => leakedKeys++);
  h.$(".subtitle-pane").addEventListener("keyup", () => leakedKeys++);
  for (const [index, key, code] of [
    [42, "Enter", "Enter"],
    [43, " ", "Space"],
  ]) {
    const row = h.rows()[index];
    assert.equal(row.tagName, "BUTTON");
    assert.equal(row.getAttribute("type"), "button");
    assert.equal(row.disabled, false);
    assert.notEqual(row.getAttribute("tabindex"), "-1");
    assert.match(row.getAttribute("aria-label"), /跳转到.*字幕第/);
    const down = new h.window.Event("keydown", {
      bubbles: true,
      cancelable: true,
    });
    Object.assign(down, { key, code });
    row.dispatchEvent(down);
    assert.equal(
      down.defaultPrevented,
      false,
      "native keyboard activation is not cancelled",
    );
    const up = new h.window.Event("keyup", { bubbles: true, cancelable: true });
    Object.assign(up, { key, code });
    row.dispatchEvent(up);
    assert.equal(up.defaultPrevented, false);
    assert.equal(
      leakedKeys,
      0,
      "activation keys must not reach outer player shortcuts",
    );
    // LinkeDOM does not synthesize native keyboard activation; explicitly test
    // its detail=0 click path, without claiming a real Chrome key press here.
    const activation = new h.window.Event("click", {
      bubbles: true,
      cancelable: true,
    });
    activation.detail = 0;
    row.dispatchEvent(activation);
    assert.equal(h.video().currentTime, index * 3);
    assert.equal(h.video().paused, true);
    assert.equal(h.video().playCalls, 0);
  }
});
test("a temporary gap with no video clears the cue and all media listeners before a late player appears", async () => {
  const h = await boot();
  await h.load();
  h.time(630.5);
  const old = h.video();
  old.remove();
  h.advance(1200);
  assert.equal(h.active().length, 0);
  for (const type of ["timeupdate", "seeking", "seeked", "loadedmetadata"])
    assert.equal(old.listeners.get(type)?.size || 0, 0);
  const next = trackedMedia(h.document.createElement("video"));
  h.document.querySelector("#playerWrap").append(next);
  h.advance(1200);
  h.time(630.5, "loadedmetadata", next);
  assert.equal(h.active()[0], h.rows()[210]);
  assertInsideReader(h, 210);
});
test("overlapping cues use the newest active start, fall back to a still-active earlier cue, and clear at the end", async () => {
  const h = await boot();
  h.subtitles.splice(
    0,
    h.subtitles.length,
    { start: 10, end: 50, text: "较长的早期字幕" },
    { start: 20, end: 25, text: "较新的字幕" },
    { start: 20, end: 21, text: "同起点的最新字幕" },
  );
  await h.load();
  for (const [time, expected] of [
    [9, -1],
    [10, 0],
    [20.5, 2],
    [21, 1],
    [25, 0],
    [50, -1],
  ]) {
    h.time(time, "seeked");
    assert.equal(h.active().length, expected < 0 ? 0 : 1);
    if (expected >= 0) assert.equal(h.active()[0], h.rows()[expected]);
  }
});
