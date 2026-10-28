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
function boot(html, readyState = "complete", stored = {}) {
  const { window, document } = parseHTML(
    "<!doctype html><html><head></head><body>" + html + "</body></html>",
  );
  Object.defineProperty(document, "readyState", {
    value: readyState,
    writable: true,
  });
  const intervals = [],
    messages = [];
  const location = {
    hostname: "www.bilibili.com",
    pathname: "/video/BV1ph4y1c7kp/",
    search: "",
    href: "https://www.bilibili.com/video/BV1ph4y1c7kp/",
  };
  window.location = location;
  const context = vm.createContext({
    window,
    top: window,
    document,
    location,
    URL,
    CustomEvent: window.CustomEvent,
    Event: window.Event,
    Map,
    Set,
    WeakMap,
    Date,
    console,
    crypto: require("node:crypto").webcrypto,
    navigator: { clipboard: { writeText: async () => {} } },
    chrome: {
      storage: {
        local: {
          get: async () => ({ ...stored }),
          set: async (value) => Object.assign(stored, value),
          remove: async (key) => delete stored[key],
        },
      },
      runtime: {
        getURL: (p) => "chrome-extension://test/" + p,
        onMessage: { addListener: (f) => messages.push(f) },
        sendMessage: async () => ({}),
      },
    },
    setInterval: (f) => (intervals.push(f), intervals.length),
    clearInterval() {},
    setTimeout: (f) => (intervals.push(f), intervals.length),
    clearTimeout() {},
  });
  for (const f of ["common/config.js", "content.js"])
    vm.runInContext(
      fs.readFileSync(path.join(root, "extension", f), "utf8"),
      context,
    );
  return {
    window,
    document,
    context,
    intervals,
    messages,
    stored,
    scan: () => intervals.forEach((f) => f()),
  };
}
const native =
  '<div id="playerWrap"><video></video></div><div id="commentapp"><bili-comments></bili-comments></div><aside class="right-container"><div class="right-container-inner scroll-sticky"><div class="up-panel-container">UP信息</div><div id="danmukuBox">弹幕</div><div class="recommend-list-v1"><img src="https://i0.hdslb.com/cover.jpg"></div></div></aside>';
test("AI panel waits for window load then embeds after UP information without moving comments or recommendations", () => {
  const h = boot(native, "loading"),
    comment = h.document.querySelector("#commentapp"),
    rec = h.document.querySelector(".recommend-list-v1"),
    commentParent = comment.parentNode,
    recParent = rec.parentNode;
  assert(
    !h.document.querySelector("#bili-codex-root"),
    "do not mount during native initialization",
  );
  h.document.readyState = "complete";
  h.window.dispatchEvent(new h.window.Event("load"));
  h.scan();
  const host = h.document.querySelector("#bili-codex-root");
  assert(host);
  assert.equal(
    host.parentElement.className,
    "right-container-inner scroll-sticky",
  );
  assert.equal(host.previousElementSibling.className, "up-panel-container");
  assert(comment.parentNode === commentParent);
  assert(rec.parentNode === recParent);
  assert.equal(
    rec.querySelector("img").getAttribute("src"),
    "https://i0.hdslb.com/cover.jpg",
  );
  assert.equal(host.shadowRoot.querySelector(".side-rail").tagName, "NAV");
  assert.equal(
    host.shadowRoot
      .querySelector('[data-tab="subtitles"]')
      .getAttribute("aria-selected"),
    "true",
  );
});
test("missing sidebar waits instead of creating a floating overlay; later sidebar is adopted", () => {
  const h = boot('<div id="playerWrap"><video></video></div>');
  assert(!h.document.querySelector("#bili-codex-root"));
  const side = h.document.createElement("aside");
  side.className = "right-container";
  h.document.body.append(side);
  h.scan();
  assert.equal(side.firstElementChild.id, "bili-codex-root");
});
test("embedded host survives native sidebar replacement and preserves its summary state", () => {
  const h = boot(native),
    host = h.document.querySelector("#bili-codex-root"),
    sidebar = host.parentElement;
  assert.equal(sidebar.className, "right-container-inner scroll-sticky");
  host.shadowRoot.querySelector('[data-tab="summary"]').click();
  const next = sidebar.cloneNode(false);
  sidebar.replaceWith(next);
  h.scan();
  assert(h.document.querySelector("#bili-codex-root") === host);
  assert(host.parentNode === next);
  assert.equal(
    host.shadowRoot
      .querySelector('[data-tab="summary"]')
      .getAttribute("aria-selected"),
    "true",
  );
});
test("collapsed assistant keeps its header in the sidebar and reopen locates the embedded panel", () => {
  const h = boot(native),
    host = h.document.querySelector("#bili-codex-root"),
    shadow = host.shadowRoot;
  shadow.querySelector(".collapse").click();
  assert(host.hasAttribute("data-collapsed"));
  assert.equal(shadow.querySelector("#panel").hidden, false);
  assert.equal(shadow.querySelector(".launcher").hidden, true);
  h.messages[0]({ type: "open-panel" });
  assert.equal(host.hasAttribute("data-collapsed"), false);
  assert.equal(
    host.parentElement.className,
    "right-container-inner scroll-sticky",
  );
});
test("panel stylesheet uses document flow and vertical navigation, without a fixed overlay", () => {
  const css = fs.readFileSync(path.join(root, "extension/panel.css"), "utf8");
  assert(!/position\s*:\s*fixed/.test(css));
  assert(/\.side-rail/.test(css));
  assert(/#ff6699|#f69\b/.test(css));
});

test("reader frame has a fixed viewport-bounded height regardless of the outer page or subtitle length", () => {
  const h = boot('<div class="video-container-v1">' + native + "</div>");
  h.window.innerHeight = 900;
  h.document.querySelector(".video-container-v1").getBoundingClientRect =
    () => ({ height: 12000 });
  const area = h.document.createElement("div");
  area.className = "bpx-player-video-area";
  area.getBoundingClientRect = () => ({ height: 480 });
  h.document.querySelector("#playerWrap").prepend(area);
  h.scan();
  const host = h.document.querySelector("#bili-codex-root");
  const height = parseFloat(host.style.getPropertyValue("--bcx-panel-height"));
  assert.equal(height, 600, "use a fixed reader frame");
  area.getBoundingClientRect = () => ({ height: 5000 });
  h.scan();
  assert(
    parseFloat(host.style.getPropertyValue("--bcx-panel-height")) <= 780,
    "do not create a page-sized empty panel",
  );
});

test("a completed summary does not label the unread subtitle tab as completed", async () => {
  const h = boot(native);
  let receive, sent;
  h.context.chrome.runtime.connect = () => ({
    onMessage: { addListener: (f) => (receive = f) },
    onDisconnect: { addListener() {} },
    postMessage: (m) => (sent = m),
    disconnect() {},
  });
  h.window.addEventListener("bili-codex-request", (e) =>
    h.window.dispatchEvent(
      new h.window.CustomEvent("bili-codex-snapshot", {
        detail: JSON.stringify({
          id: JSON.parse(e.detail).id,
          bvid: "BV1ph4y1c7kp",
          cid: 1,
        }),
      }),
    ),
  );
  const shadow = h.document.querySelector("#bili-codex-root").shadowRoot;
  shadow.querySelector(".start").click();
  await new Promise(setImmediate);
  receive({
    id: sent.id,
    type: "result",
    meta: { kind: "summary", subtitleCount: 83, elapsedMs: 12000 },
    result: { summary: "测试总结", keyPoints: [], segments: [] },
  });
  assert(shadow.querySelector(".status").textContent.includes("83"));
  shadow.querySelector('[data-tab="subtitles"]').click();
  assert.equal(shadow.querySelector(".subtitle-placeholder").hidden, false);
  assert.equal(
    shadow.querySelector(".status").hidden,
    true,
    "the summary status must stay with the summary tab",
  );
  shadow.querySelector('[data-tab="summary"]').click();
  assert(shadow.querySelector(".status").textContent.includes("83"));
  assert.equal(shadow.querySelector(".result").hidden, false);
});

test("83 returned subtitle lines stay inside the reader and their time buttons still seek", async () => {
  const h = boot(native);
  let receive, sent;
  h.context.chrome.runtime.connect = () => ({
    onMessage: { addListener: (f) => (receive = f) },
    onDisconnect: { addListener() {} },
    postMessage: (m) => (sent = m),
    disconnect() {},
  });
  h.window.addEventListener("bili-codex-request", (e) =>
    h.window.dispatchEvent(
      new h.window.CustomEvent("bili-codex-snapshot", {
        detail: JSON.stringify({
          id: JSON.parse(e.detail).id,
          bvid: "BV1ph4y1c7kp",
          cid: 1,
        }),
      }),
    ),
  );
  const host = h.document.querySelector("#bili-codex-root"),
    shadow = host.shadowRoot;
  shadow.querySelector(".read").click();
  await new Promise(setImmediate);
  receive({
    id: sent.id,
    type: "result",
    meta: { kind: "subtitles", subtitleCount: 83 },
    result: {
      bvid: "BV1ph4y1c7kp",
      cid: 1,
      source: "official",
      language: "中文",
      subtitles: Array.from({ length: 83 }, (_, i) => ({
        start: i,
        end: i + 1,
        text: "字幕第" + (i + 1) + "条",
      })),
    },
  });
  assert.equal(shadow.querySelectorAll(".subtitle-line").length, 83);
  assert.equal(shadow.querySelector(".subtitle-placeholder").hidden, true);
  assert.equal(shadow.querySelector(".read").textContent, "重新读取字幕");
  assert.equal(shadow.querySelector(".pane-badge").textContent, "字幕已就绪");
  shadow.querySelectorAll(".subtitle-line")[82].click();
  assert.equal(h.document.querySelector("video").currentTime, 82);
  assert.equal(
    parseFloat(host.style.getPropertyValue("--bcx-panel-height")),
    600,
  );
  const css = fs.readFileSync(path.join(root, "extension/panel.css"), "utf8");
  assert(/\.transcript,\s*\.chat-log\s*\{[^}]*overflow-y:\s*auto/.test(css));
  assert(/overscroll-behavior:\s*contain/.test(css));
});

test("automatic ad recognition keeps the default subtitle tab and a new video resets to subtitles", () => {
  const h = boot(native),
    host = h.document.querySelector("#bili-codex-root"),
    shadow = host.shadowRoot,
    video = h.document.querySelector("video");
  h.context.BiliFeatures = {
    context: {
      settings: () => h.context.BiliConfig.normalize({ ai: { autoAds: true } }),
    },
  };
  video.paused = false;
  video.currentTime = 16;
  video.duration = 90;
  video.dispatchEvent(new h.window.Event("timeupdate"));
  assert.equal(
    shadow
      .querySelector('[data-tab="subtitles"]')
      .getAttribute("aria-selected"),
    "true",
    "automatic work must not navigate away from the subtitle reader",
  );
  shadow.querySelector('[data-tab="ads"]').click();
  h.context.location.pathname = "/video/BV1ab4y1c7kP/";
  h.scan();
  assert.equal(
    shadow
      .querySelector('[data-tab="subtitles"]')
      .getAttribute("aria-selected"),
    "true",
    "each video opens on subtitles",
  );
});

test("the whole reader can be resized by pointer and keyboard, persists, and resets without losing the frame gap", async () => {
  const h = boot(native),
    host = h.document.querySelector("#bili-codex-root"),
    handle = host.shadowRoot.querySelector(".panel-resizer");
  assert(handle, "provide a visible height resize handle");
  const pointer = (type, y) => {
    const e = new h.window.Event(type);
    e.clientY = y;
    e.pointerId = 1;
    return e;
  };
  handle.dispatchEvent(pointer("pointerdown", 600));
  handle.dispatchEvent(pointer("pointermove", 840));
  handle.dispatchEvent(pointer("pointerup", 840));
  assert.equal(
    parseFloat(host.style.getPropertyValue("--bcx-panel-height")),
    840,
  );
  assert.equal(h.stored.assistantPanelHeight, 840);
  h.scan();
  h.window.dispatchEvent(new h.window.Event("resize"));
  assert.equal(
    parseFloat(host.style.getPropertyValue("--bcx-panel-height")),
    840,
    "mount scans must preserve the chosen height",
  );
  const key = new h.window.Event("keydown");
  key.code = "ArrowDown";
  handle.dispatchEvent(key);
  assert.equal(
    parseFloat(host.style.getPropertyValue("--bcx-panel-height")),
    880,
  );
  const reopened = boot(native, "complete", {
    assistantPanelHeight: h.stored.assistantPanelHeight,
  });
  await new Promise(setImmediate);
  assert.equal(
    parseFloat(
      reopened.document
        .querySelector("#bili-codex-root")
        .style.getPropertyValue("--bcx-panel-height"),
    ),
    880,
  );
  handle.dispatchEvent(new h.window.Event("dblclick"));
  assert.equal(
    parseFloat(host.style.getPropertyValue("--bcx-panel-height")),
    600,
  );
  assert.equal(host.style.getPropertyValue("margin-bottom"), "16px");
});

test("subtitle controls share a compact toolbar and export formats remain available through one selector", () => {
  const h = boot(native),
    shadow = h.document.querySelector("#bili-codex-root").shadowRoot;
  const toolbar = shadow.querySelector(".subtitle-toolbar");
  assert(toolbar?.contains(shadow.querySelector(".read")));
  assert(toolbar.contains(shadow.querySelector(".polish")));
  const select = toolbar.querySelector('select[aria-label="导出字幕"]');
  assert.deepEqual(
    [...select.options].filter((o) => o.value).map((o) => o.value),
    ["srt", "txt", "json"],
  );
});
