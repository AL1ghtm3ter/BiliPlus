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
const fixture =
  '<main id="mirror-vdcon"><div class="left-container"><h1>测试视频</h1><div id="playerWrap"><video></video><div class="bpx-player-control-bottom-right"><i class="bpx-player-ctrl-pip"></i><span class="bpx-player-ctrl-playbackrate-result">倍速</span><ul class="bpx-player-ctrl-playbackrate-menu"><li class="bpx-player-ctrl-playbackrate-menu-item">1x</li></ul></div></div><div id="v_desc"><p class="basic-desc-info-text">测试简介</p></div><div id="commentapp">评论原生节点</div></div><aside class="right-container"><div class="action-list-container">合集原生节点</div><div id="danmukuBox">弹幕原生节点</div><div class="recommend-list-v1">推荐原生节点</div></aside></main>';
const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise(setImmediate);
};
async function harness(settings = {}, initialDuration = 200) {
  const { window, document } = parseHTML(
    "<html><head></head><body>" + fixture + "</body></html>",
  );
  const location = {
    hostname: "www.bilibili.com",
    pathname: "/video/BV1ph4y1c7kp/",
    search: "",
  };
  window.location = location;
  const timers = new Map(),
    writes = [],
    listeners = [];
  let now = 0,
    serial = 0,
    restarts = 0;
  const schedule = (fn, delay = 0, repeat = false) => {
    const id = ++serial;
    timers.set(id, { fn, delay, repeat, due: now + delay });
    return id;
  };
  function advance(ms) {
    const until = now + ms;
    let count = 0;
    while (true) {
      const x = [...timers].sort((a, b) => a[1].due - b[1].due)[0];
      if (!x || x[1].due > until) break;
      assert(++count < 2000, "timers settle");
      const [id, t] = x;
      now = t.due;
      t.repeat ? (t.due += t.delay) : timers.delete(id);
      t.fn();
    }
    now = until;
  }
  function media(video) {
    let playback = 1.25,
      base = 1.1;
    for (const key of ["playbackRate", "defaultPlaybackRate"])
      Object.defineProperty(video, key, {
        configurable: true,
        get: () => (key === "playbackRate" ? playback : base),
        set: (value) => {
          if (key === "playbackRate") playback = value;
          else base = value;
          video.dispatchEvent(new window.Event("ratechange"));
        },
      });
    video.currentTime = 0;
    video.duration = initialDuration;
    return video;
  }
  media(document.querySelector("video"));
  const chrome = {
    storage: {
      onChanged: { addListener: (fn) => listeners.push(fn) },
      local: {
        get: async () => ({ biliSettings: settings }),
        set: async (value) => {
          writes.push(structuredClone(value));
          for (const fn of listeners)
            fn({ biliSettings: { newValue: value.biliSettings } }, "local");
        },
      },
    },
  };
  const context = vm.createContext({
    window,
    document,
    location,
    chrome,
    CustomEvent: window.CustomEvent,
    Event: window.Event,
    MutationObserver: window.MutationObserver,
    console,
    setTimeout: (fn, delay) => schedule(fn, delay),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, delay) => schedule(fn, delay, true),
    clearInterval: (id) => timers.delete(id),
  });
  window.addEventListener("bili-codex-settings-change", () => restarts++);
  for (const file of [
    "common/config.js",
    "features/runtime.js",
    "features/player.js",
    "features/layout.js",
    "features/index.js",
  ])
    vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, {
      filename: file,
    });
  await settle();
  function event(target, type, properties = {}) {
    const e = new window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, properties);
    target.dispatchEvent(e);
    return e;
  }
  return {
    window,
    document,
    location,
    advance,
    media,
    writes,
    event,
    state: context.BiliFeatures.context,
    runtime: context.BiliFeatures,
    restarts: () => restarts,
  };
}
const speed = (h) => h.document.querySelector('[data-bcx-widget="speed"]');
const separator = (h) =>
  h.document.querySelector('[data-bcx-right-comments]>[role="separator"]');

test("QA speed menu displays largest rate first without changing shortcut bindings or saved presets", async () => {
  const h = await harness({
    player: {
      speedEnabled: true,
      presets: [0.5, 1, 1.5, 2, 3, 4, 5],
      presetShortcuts: ["Shift+Digit1"],
      shortcutRates: [1.5],
    },
  });
  const rates = [...speed(h).querySelectorAll("[data-bcx-speed-option]")].map(
    (b) => Number(b.getAttribute("data-bcx-speed-option")),
  );
  assert.deepEqual(rates, [5, 4, 3, 2, 1.5, 1, 0.5]);
  assert.equal(h.state.settings().player.presets[0], 0.5);
  h.event(h.document, "keydown", { code: "Digit1", shiftKey: true });
  assert.equal(h.document.querySelector("video").playbackRate, 1.5);
});

test("QA speed slider, every preset and custom shortcuts update the actual media and persisted selection", async () => {
  const h = await harness({
      player: {
        speedEnabled: true,
        speed: 1,
        speedUpShortcut: "Ctrl+KeyQ",
        speedDownShortcut: "Ctrl+KeyA",
        step: 0.4,
        presetShortcuts: ["Shift+Digit1", "Shift+Digit2"],
        shortcutRates: [1.3, 2.7],
      },
    }),
    video = h.document.querySelector("video");
  const range = speed(h).querySelector("input");
  range.value = "1.37";
  h.event(range, "input");
  assert.equal(video.playbackRate, 1.37);
  for (const button of [
    ...speed(h).querySelectorAll("[data-bcx-speed-option]"),
  ]) {
    button.click();
    assert.equal(
      video.playbackRate,
      Number(button.getAttribute("data-bcx-speed-option")),
    );
  }
  h.event(h.document, "keydown", { code: "Digit2", shiftKey: true });
  assert.equal(video.playbackRate, 2.7);
  h.event(h.document, "keydown", { code: "KeyQ", ctrlKey: true });
  assert.equal(video.playbackRate, 3.1);
  h.event(h.document, "keydown", { code: "KeyA", ctrlKey: true });
  assert.equal(video.playbackRate, 2.7);
  h.advance(600);
  await settle();
  assert.equal(h.writes.at(-1).biliSettings.player.speed, 2.7);
  assert.equal(h.restarts(), 1);
  for (const tag of ["input", "textarea", "select"]) {
    const input = h.document.createElement(tag);
    h.document.body.append(input);
    h.event(input, "keydown", { code: "KeyQ", ctrlKey: true });
    assert.equal(
      video.playbackRate,
      2.7,
      tag + " must keep shortcut for editing",
    );
  }
});

test("QA shortcuts do not alter playback when composed keydown originated inside a ShadowDOM editor", async () => {
  const h = await harness({ player: { speedEnabled: true, speed: 1.5 } }),
    video = h.document.querySelector("video"),
    host = h.document.createElement("div");
  h.document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" }),
    textarea = h.document.createElement("textarea");
  shadow.append(textarea);
  // In a browser the document listener sees the shadow host as event.target.
  // composedPath retains the actual textarea, unlike the retargeted target.
  const e = new h.window.Event("keydown", { bubbles: true, cancelable: true });
  Object.assign(e, { code: "ArrowUp", altKey: true });
  e.composedPath = () => [
    textarea,
    shadow,
    host,
    h.document.body,
    h.document,
    h.window,
  ];
  host.dispatchEvent(e);
  assert.equal(
    video.playbackRate,
    1.5,
    "typing in the extension chat editor must not trigger the global speed shortcut",
  );
  assert.equal(
    e.defaultPrevented,
    false,
    "editor keyboard action must remain available",
  );
});

test("QA fullscreen range seeks media, follows time updates, hides on exit, and restores on rebuilt media", async () => {
  const h = await harness({ player: { fullscreenProgress: true } }),
    player = h.document.querySelector("#playerWrap"),
    video = player.querySelector("video");
  h.document.fullscreenElement = player;
  h.event(h.document, "fullscreenchange");
  const host = h.document.querySelector(
      '[data-bcx-widget="fullscreen-progress"]',
    ),
    range = host.shadowRoot.querySelector("input");
  assert.equal(host.hidden, false);
  range.value = "73.5";
  h.event(range, "input");
  assert.equal(video.currentTime, 73.5);
  video.currentTime = 81;
  video.duration = 240;
  h.event(video, "timeupdate");
  assert.equal(Number(range.value), 81);
  assert.equal(Number(range.max), 240);
  h.document.fullscreenElement = null;
  h.event(h.document, "fullscreenchange");
  assert.equal(host.hidden, true);
  const replacement = h.media(h.document.createElement("video"));
  replacement.duration = 500;
  video.replaceWith(replacement);
  h.advance(1200);
  h.document.fullscreenElement = player;
  h.event(h.document, "fullscreenchange");
  range.value = "110";
  h.event(range, "input");
  assert.equal(replacement.currentTime, 110);
  assert.equal(video.currentTime, 81);
  h.state.patch("player.fullscreenProgress", false);
  assert.equal(
    h.document.querySelector('[data-bcx-widget="fullscreen-progress"]'),
    null,
  );
});

test("QA editing ArrowRight inside ShadowDOM does not suspend selected-speed enforcement", async () => {
  const h = await harness({ player: { speedEnabled: true, speed: 1.5 } }),
    video = h.document.querySelector("video"),
    host = h.document.createElement("div");
  h.document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" }),
    input = h.document.createElement("input");
  shadow.append(input);
  const e = new h.window.Event("keydown", { bubbles: true, cancelable: true });
  e.code = "ArrowRight";
  e.composedPath = () => [
    input,
    shadow,
    host,
    h.document.body,
    h.document,
    h.window,
  ];
  host.dispatchEvent(e);
  video.playbackRate = 3;
  assert.equal(
    video.playbackRate,
    1.5,
    "cursor movement in an editor is not native temporary video acceleration",
  );
});

test("QA paused media metadata updates the fullscreen seek range before the first timeupdate", async () => {
  const h = await harness({ player: { fullscreenProgress: true } }, 0),
    player = h.document.querySelector("#playerWrap"),
    video = player.querySelector("video");
  video.duration = 240;
  h.event(video, "loadedmetadata");
  h.document.fullscreenElement = player;
  h.event(h.document, "fullscreenchange");
  const range = h.document
    .querySelector('[data-bcx-widget="fullscreen-progress"]')
    .shadowRoot.querySelector("input");
  assert.equal(
    Number(range.max ?? range.getAttribute("max")),
    240,
    "a paused newly loaded video must allow seeking beyond the initial 1-second placeholder",
  );
  video.duration = 480;
  h.event(video, "durationchange");
  assert.equal(
    Number(range.max ?? range.getAttribute("max")),
    480,
    "duration changes while paused in fullscreen must also update the range",
  );
  h.state.patch("player.fullscreenProgress", false);
  video.duration = 600;
  h.event(video, "loadedmetadata");
  assert.equal(
    Number(range.max ?? range.getAttribute("max")),
    480,
    "disabled progress must remove its metadata listeners",
  );
});

test("QA right comments move only current player/comments while retaining native sidebar nodes and listeners", async () => {
  const h = await harness({ layout: { rightComments: true } }),
    comments = h.document.querySelector("#commentapp"),
    side = h.document.querySelector(".right-container"),
    originals = [...side.children];
  assert(comments.closest("[data-bcx-comment-column]"));
  assert.equal(
    h.document.querySelectorAll("[data-bcx-tab],[data-bcx-pane]").length,
    0,
  );
  assert(!h.document.querySelector('[data-bcx-widget="split-control"]'));
  for (const node of originals) assert.equal(node.parentElement, side);
  let received = 0;
  comments.addEventListener("qa-comment-event", () => received++);
  h.event(comments, "qa-comment-event");
  assert.equal(received, 1);
  h.state.patch("layout.rightComments", false);
  assert.equal(comments.parentElement.className, "left-container");
  for (const node of originals) assert.equal(node.parentElement, side);
  h.event(comments, "qa-comment-event");
  assert.equal(received, 2);
});
test("QA right-comment width drag and keyboard enforce bounds, persist and survive independent settings restarts", async () => {
  const h = await harness({ layout: { rightComments: true } });
  const shell = h.document.querySelector("[data-bcx-right-comments]");
  shell.getBoundingClientRect = () => ({ right: 1200 });
  h.event(separator(h), "pointerdown", { pointerId: 1 });
  h.event(h.window, "pointermove", { clientX: 570 });
  assert.equal(separator(h).getAttribute("aria-valuenow"), "630");
  h.event(h.window, "pointerup");
  assert.equal(h.state.settings().layout.commentWidthPx, 630);
  h.event(separator(h), "keydown", { code: "ArrowLeft" });
  assert.equal(h.state.settings().layout.commentWidthPx, 650);
  h.state.patch("player.step", 0.5);
  assert.match(
    h.document.querySelector("[data-bcx-right-comments]").style
      .gridTemplateColumns,
    /650px/,
  );
  for (let i = 0; i < 20; i++)
    h.event(separator(h), "keydown", { code: "ArrowLeft" });
  assert.equal(h.state.settings().layout.commentWidthPx, 800);
  for (let i = 0; i < 30; i++)
    h.event(separator(h), "keydown", { code: "ArrowRight" });
  assert.equal(h.state.settings().layout.commentWidthPx, 300);
  h.advance(600);
  await settle();
  assert.equal(h.writes.at(-1).biliSettings.layout.commentWidthPx, 300);
});
test("QA disabling right comments restores exact native comments/player positions without a split entry", async () => {
  const h = await harness({
      layout: { rightComments: true, commentWidthPx: 420 },
    }),
    comments = h.document.querySelector("#commentapp"),
    player = h.document.querySelector("#playerWrap");
  assert.match(
    h.document.querySelector("[data-bcx-right-comments]").style
      .gridTemplateColumns,
    /420px/,
  );
  h.event(separator(h), "keydown", { code: "ArrowLeft" });
  assert.equal(h.state.settings().layout.commentWidthPx, 440);
  h.state.patch("layout.rightComments", false);
  assert(!h.document.querySelector("[data-bcx-right-comments]"));
  assert.equal(player.parentElement.className, "left-container");
  assert.equal(comments.parentElement.className, "left-container");
  assert.equal(player.nextElementSibling.id, "v_desc");
  assert.equal(player.nextElementSibling.nextElementSibling, comments);
  assert(!h.document.querySelector('[data-bcx-widget="split-control"]'));
});
test("QA late comments are adopted and route exit restores the replacement without resurrecting removed comments", async () => {
  const h = await harness({ layout: { rightComments: true } }),
    old = h.document.querySelector("#commentapp");
  old.remove();
  const late = h.document.createElement("div");
  late.id = "commentapp";
  late.textContent = "新加载评论";
  h.document.querySelector(".left-container").append(late);
  h.advance(1200);
  assert(late.closest("[data-bcx-comment-column]"));
  h.location.pathname = "/";
  h.advance(1000);
  assert(!h.document.querySelector("[data-bcx-right-comments]"));
  assert.equal(late.parentElement.className, "left-container");
  assert.equal(old.isConnected, false);
});
test("QA settings restart preserves a comment node replaced inside the owned sidebar before the DOM scan", async () => {
  const h = await harness({ layout: { rightComments: true } }),
    old = h.document.querySelector("#commentapp"),
    replacement = h.document.createElement("div");
  replacement.id = "commentapp";
  replacement.textContent = "替换后的原生评论";
  old.replaceWith(replacement);
  h.state.patch("player.step", 0.5);
  await settle();
  assert.equal(
    old.isConnected,
    false,
    "cleanup must not resurrect the removed comment node",
  );
  assert(replacement.closest("[data-bcx-comment-column]"));
  h.state.patch("layout.rightComments", false);
  assert.equal(replacement.parentElement.className, "left-container");
  assert.equal(replacement.previousElementSibling.id, "v_desc");
});
test("QA disabling after the right-comments container is detached restores its intact native nodes", async () => {
  const h = await harness({ layout: { rightComments: true } }),
    player = h.document.querySelector("#playerWrap"),
    comments = h.document.querySelector("#commentapp"),
    shell = h.document.querySelector("[data-bcx-right-comments]");
  shell.remove();
  assert.equal(player.isConnected, false);
  assert.equal(comments.isConnected, false);
  h.state.patch("layout.rightComments", false);
  assert.equal(player.parentElement.className, "left-container");
  assert.equal(comments.parentElement.className, "left-container");
  assert(player.isConnected && comments.isConnected);
});

test("QA external native replacements win over the detached right-comments container during cleanup", async () => {
  const h = await harness({ layout: { rightComments: true } }),
    oldPlayer = h.document.querySelector("#playerWrap"),
    oldComments = h.document.querySelector("#commentapp"),
    shell = h.document.querySelector("[data-bcx-right-comments]"),
    replacementPlayer = h.document.createElement("div"),
    replacementComments = h.document.createElement("div");
  replacementPlayer.id = "playerWrap";
  replacementComments.id = "commentapp";
  replacementPlayer.append(h.document.createElement("video"));
  shell.remove();
  h.document
    .querySelector(".left-container")
    .append(replacementPlayer, replacementComments);
  h.state.patch("layout.rightComments", false);
  assert.equal(
    oldPlayer.isConnected,
    false,
    "removed layout must not restore the obsolete player over a native replacement",
  );
  assert.equal(
    oldComments.isConnected,
    false,
    "removed layout must not restore obsolete comments over a native replacement",
  );
  assert(replacementPlayer.isConnected && replacementComments.isConnected);
  assert.equal(h.document.querySelectorAll("#playerWrap").length, 1);
  assert.equal(h.document.querySelectorAll("#commentapp").length, 1);
});

test("QA owned-move cleanup recovers an original node when only its extension container was detached", async () => {
  const h = await harness(),
    source = h.document.createElement("section"),
    ownedContainer = h.document.createElement("aside"),
    nativeNode = h.document.createElement("div");
  source.append(nativeNode);
  h.document.body.append(source, ownedContainer);
  const scope = new h.runtime.Scope();
  scope.move(nativeNode, ownedContainer);
  ownedContainer.remove();
  assert.equal(nativeNode.isConnected, false);
  assert.equal(nativeNode.parentElement, ownedContainer);
  scope.clean();
  assert.equal(
    nativeNode.parentElement,
    source,
    "an intact owned node must return even when the extension container was detached",
  );
  assert.equal(nativeNode.isConnected, true);
});
