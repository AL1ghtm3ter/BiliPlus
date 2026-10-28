const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const { parseHTML } = require("linkedom");
const root = path.resolve(__dirname, "..", "extension");
const speedMenuMarkup =
  '<div class="bpx-player-ctrl-playbackrate"><span class="bpx-player-ctrl-playbackrate-result">倍速</span><ul class="bpx-player-ctrl-playbackrate-menu" style="width:68px"><li class="bpx-player-ctrl-playbackrate-menu-item" data-value="2">2.0x</li><li class="bpx-player-ctrl-playbackrate-menu-item" data-value="1">1.0x</li></ul></div>';
const fixture =
  '<main id="mirror-vdcon"><div class="left-container"><h1>视频</h1><div id="playerWrap"><video></video><div class="bpx-player-control-bottom-right"><span class="bpx-player-ctrl-pip"></span>' +
  speedMenuMarkup +
  '</div></div><div id="v_desc">简介</div><div id="commentapp">评论</div></div><aside class="right-container"></aside></main>';

async function harness(settings, html = fixture) {
  const { window, document } = parseHTML(
    "<!doctype html><html><head></head><body>" + html + "</body></html>",
  );
  const location = {
    hostname: "www.bilibili.com",
    pathname: "/video/BV1ph4y1c7kp/",
    search: "",
  };
  window.location = location;
  const timers = new Map(),
    writes = [],
    storageListeners = [];
  let now = 0,
    serial = 0,
    restarts = 0;
  const schedule = (fn, delay = 0, repeat = false) => {
    const id = ++serial;
    timers.set(id, { fn, due: now + delay, delay, repeat });
    return id;
  };
  function advance(ms) {
    const until = now + ms;
    let callbacks = 0;
    while (true) {
      const next = [...timers].sort((a, b) => a[1].due - b[1].due)[0];
      if (!next || next[1].due > until) break;
      assert(++callbacks < 1000, "timers must settle without a restart loop");
      const [id, timer] = next;
      now = timer.due;
      if (timer.repeat) timer.due += timer.delay;
      else timers.delete(id);
      timer.fn();
    }
    now = until;
  }
  // Linkedom does not implement media rates. Dispatch the real ratechange
  // contract synchronously so a missing re-entry guard fails deterministically.
  function media(video, playback = 1.25, defaultRate = 1.1) {
    const rates = { playbackRate: playback, defaultPlaybackRate: defaultRate };
    for (const [key, initial] of [
      ["playbackRate", playback],
      ["defaultPlaybackRate", defaultRate],
    ]) {
      rates[key] = initial;
      Object.defineProperty(video, key, {
        configurable: true,
        get: () => rates[key],
        set(next) {
          if (rates[key] === next) return;
          rates[key] = next;
          video.dispatchEvent(new window.Event("ratechange"));
        },
      });
    }
    video.resetRates = (playback, defaultRate) => {
      rates.playbackRate = playback;
      rates.defaultPlaybackRate = defaultRate;
    };
    video.duration = 120;
    video.currentTime = 0;
    return video;
  }
  for (const video of document.querySelectorAll("video")) media(video);
  const chrome = {
    storage: {
      onChanged: { addListener: (fn) => storageListeners.push(fn) },
      local: {
        get: async () => ({ biliSettings: settings }),
        set: async (value) => {
          writes.push(structuredClone(value));
          for (const fn of storageListeners)
            fn({ biliSettings: { newValue: value.biliSettings } }, "local");
        },
      },
    },
  };
  window.addEventListener("bili-codex-settings-change", () => restarts++);
  const context = vm.createContext({
    window,
    document,
    location,
    chrome,
    CustomEvent: window.CustomEvent,
    Event: window.Event,
    setTimeout: (fn, delay) => schedule(fn, delay),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, delay) => schedule(fn, delay, true),
    clearInterval: (id) => timers.delete(id),
    console,
  });
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
  await new Promise(setImmediate);
  return {
    window,
    document,
    media,
    advance,
    writes,
    state: context.BiliFeatures.context,
    intervals: () => [...timers.values()].filter((t) => t.repeat).length,
    restarts: () => restarts,
    key(type, code, target = document) {
      const event = new window.Event(type, { bubbles: true, cancelable: true });
      event.code = code;
      target.dispatchEvent(event);
      return event;
    },
  };
}

const speedHost = (h) => h.document.querySelector('[data-bcx-widget="speed"]');
const splitHost = (h) => h.document.querySelector("[data-bcx-split]");
const sameNode = (actual, expected, message = "DOM node should match") =>
  assert(actual === expected, message);
function assertInMenu(h, player = h.document.querySelector("#playerWrap")) {
  const menu = player.querySelector(".bpx-player-ctrl-playbackrate-menu");
  assert(speedHost(h), "speed controls should exist in the native menu");
  sameNode(
    speedHost(h).parentElement,
    menu,
    "speed controls belong inside the native menu",
  );
  assert.equal(speedHost(h).tagName, "LI");
  assert(player.contains(speedHost(h)), "the player owns its speed controls");
}

test("actual index startup remounts removed speed controls and preserves one live scan after patch restarts", async () => {
  const h = await harness({ player: { speedEnabled: true, speed: 1.75 } }),
    player = h.document.querySelector("#playerWrap"),
    host = speedHost(h);
  host.remove();
  h.advance(1200);
  assert(speedHost(h)?.isConnected, "detached speed controls must reattach");
  assertInMenu(h, player);
  const mounted = speedHost(h);
  h.advance(6000);
  sameNode(speedHost(h), mounted, "stable controls should not be recreated");
  assert.equal(
    h.document.querySelectorAll('[data-bcx-widget="speed"]').length,
    1,
  );
  h.state.patch("player.step", 0.5);
  h.advance(6000);
  assert.equal(h.intervals(), 2, "restart must clear the previous player scan");
  assert.equal(
    h.restarts(),
    2,
    "storage acknowledgement must not restart again",
  );
  h.state.patch("player.speedEnabled", false);
  assert.equal(speedHost(h), null);
  assert.equal(h.intervals(), 1);
  h.advance(6000);
  assert.equal(
    speedHost(h),
    null,
    "cancelled scans must not resurrect controls",
  );
});

test("index startup and settings restart keep speed controls inside the split player column", async () => {
  const h = await harness({
    player: { speedEnabled: true, speed: 2 },
    layout: { split: true },
  });
  function assertColumn() {
    const player = h.document.querySelector("#playerWrap");
    assert.equal(player.parentElement.getAttribute("data-bcx-left"), "1");
    assertInMenu(h, player);
  }
  assertColumn();
  h.state.patch("layout.sideWidthPx", 500);
  assertColumn();
  const mountedMenu = h.document.querySelector(
      ".bpx-player-ctrl-playbackrate-menu",
    ),
    append = mountedMenu.append;
  let moves = 0;
  mountedMenu.append = function (...nodes) {
    moves++;
    return append.apply(this, nodes);
  };
  h.advance(6000);
  assertColumn();
  assert.equal(
    moves,
    0,
    "stable scans must not repeatedly move speed controls",
  );
  assert.equal(h.intervals(), 3);
  assert.equal(h.restarts(), 2);
  const control = h.document.querySelector('[data-bcx-widget="split-control"]');
  control.shadowRoot.querySelector("button").click();
  const player = h.document.querySelector("#playerWrap");
  assert.equal(splitHost(h), null);
  assert.equal(player.parentElement.className, "left-container");
  assertInMenu(h, player);
  sameNode(
    h.document.querySelector("#commentapp").parentElement,
    player.parentElement,
  );
});

for (const place of ["inside", "outside"])
  test(`same-URL ${place} player reconstruction is adopted and the rebuilt player survives closing split`, async () => {
    const h = await harness({
        player: { speedEnabled: true, speed: 2 },
        layout: { split: true },
      }),
      old = h.document.querySelector("#playerWrap"),
      oldVideo = old.querySelector("video"),
      shell = splitHost(h),
      originalParent = shell.parentElement,
      desc = h.document.querySelector("#v_desc"),
      next = old.cloneNode(true);
    for (const widget of next.querySelectorAll("[data-bcx-widget]"))
      widget.remove();
    const nextVideo = h.media(next.querySelector("video"), 1.3, 1.2);
    if (place === "inside") old.replaceWith(next);
    else {
      old.remove();
      desc.before(next);
    }
    h.advance(1200);
    assert.equal(next.parentElement.getAttribute("data-bcx-left"), "1");
    assertInMenu(h, next);
    assert.equal(nextVideo.playbackRate, 2);
    assert.equal(oldVideo.playbackRate, 1.25);
    assert(next.querySelector('[data-bcx-widget="split-control"]'));
    h.advance(6000);
    sameNode(
      splitHost(h),
      shell,
      "reconstruction should not remount each scan",
    );
    assert.equal(h.restarts(), 1, "DOM recovery should not restart settings");
    assert.equal(h.intervals(), 3);
    h.state.patch("layout.splitActive", false);
    assert(next.isConnected, "cleanup must preserve the rebuilt player");
    sameNode(next.parentElement, originalParent);
    assertInMenu(h, next);
    sameNode(next.nextElementSibling, desc);
    assert(!old.isConnected, "cleanup must not resurrect the obsolete player");
    assert.equal(splitHost(h), null);
    sameNode(
      h.document.querySelector("#commentapp").parentElement,
      originalParent,
    );
    h.state.patch("player.speedEnabled", false);
    assert.equal(nextVideo.playbackRate, 1.3);
    assert.equal(nextVideo.defaultPlaybackRate, 1.2);
    h.advance(6000);
    assert.equal(h.document.querySelectorAll("#playerWrap").length, 1);
  });

test("a settings restart before the DOM scan preserves a rebuilt player even when its original marker disappeared", async () => {
  const h = await harness({
      player: { speedEnabled: true, speed: 2 },
      layout: { split: true },
    }),
    old = h.document.querySelector("#playerWrap"),
    shell = splitHost(h),
    parent = shell.parentElement,
    next = old.cloneNode(true);
  for (const widget of next.querySelectorAll("[data-bcx-widget]"))
    widget.remove();
  const video = h.media(next.querySelector("video"), 1.3, 1.2);
  old.replaceWith(next);
  for (const node of [...parent.childNodes])
    if (node.nodeType === 8) node.remove();
  h.state.patch("layout.splitActive", false);
  assert(
    next.isConnected,
    "cleanup before the scan must preserve the new player",
  );
  sameNode(next.parentElement, parent);
  assertInMenu(h, next);
  assert(!old.isConnected);
  assert.equal(video.playbackRate, 2);
  h.state.patch("player.speedEnabled", false);
  assert.equal(video.playbackRate, 1.3);
  assert.equal(video.defaultPlaybackRate, 1.2);
});

test("selected speed survives native media resets, shortcut changes, and restores both original media rates on disable", async () => {
  const h = await harness({ player: { speedEnabled: true, speed: 1.75 } }),
    video = h.document.querySelector("#playerWrap video");
  for (const type of ["loadedmetadata", "canplay", "play", "ratechange"]) {
    video.resetRates(1, 1);
    video.dispatchEvent(new h.window.Event(type));
    assert.equal(video.playbackRate, 1.75, type);
    assert.equal(video.defaultPlaybackRate, 1.75, type);
  }
  const twice = [...speedHost(h).querySelectorAll("button")].find(
    (button) => button.textContent === "2x",
  );
  twice.click();
  video.playbackRate = 1;
  assert.equal(video.playbackRate, 2);
  assert.equal(h.state.settings().player.speed, 2);
  assert.equal(
    h.document.querySelector(".bpx-player-ctrl-playbackrate-result")
      .textContent,
    "2x",
  );
  h.advance(600);
  assert.equal(h.writes.at(-1).biliSettings.player.speed, 2);
  assert.equal(
    h.restarts(),
    1,
    "speed selection should not restart the player",
  );
  h.state.patch("player.speedEnabled", false);
  assert.equal(video.playbackRate, 1.25);
  assert.equal(video.defaultPlaybackRate, 1.1);
  video.playbackRate = 1;
  video.dispatchEvent(new h.window.Event("play"));
  assert.equal(
    video.playbackRate,
    1,
    "disabled listeners must not enforce speed",
  );
});

test("native ArrowRight temporary speed is respected until keyup or blur and pending restoration is cancelled on disable", async () => {
  const h = await harness({ player: { speedEnabled: true, speed: 1.75 } }),
    video = h.document.querySelector("video");
  for (const release of ["keyup", "blur"]) {
    h.key("keydown", "ArrowRight");
    video.playbackRate = 3;
    video.dispatchEvent(new h.window.Event("ratechange"));
    assert.equal(video.playbackRate, 3, "held native shortcut must retain 3×");
    if (release === "keyup") h.key("keyup", "ArrowRight");
    else h.window.dispatchEvent(new h.window.Event("blur"));
    video.playbackRate = 1;
    h.advance(500);
    assert.equal(video.playbackRate, 1.75, release);
    assert.equal(h.state.settings().player.speed, 1.75);
  }
  h.key("keydown", "ArrowRight");
  video.playbackRate = 3;
  h.key("keyup", "ArrowRight");
  h.state.patch("player.speedEnabled", false);
  h.advance(2000);
  assert.equal(video.playbackRate, 1.25);
  assert.equal(video.defaultPlaybackRate, 1.1);
  const custom = await harness({
    player: { speedEnabled: true, speed: 1.75, speedUpShortcut: "ArrowRight" },
  });
  assert.equal(custom.key("keydown", "ArrowRight").defaultPrevented, true);
  assert.equal(custom.document.querySelector("video").playbackRate, 2);
  assert.equal(custom.state.settings().player.speed, 2);
});

test("the main player wins over an earlier preview video and fullscreen progress reattaches after its host is removed", async () => {
  const h = await harness(
      { player: { speedEnabled: true, speed: 2, fullscreenProgress: true } },
      "<aside><video></video></aside>" + fixture,
    ),
    preview = h.document.querySelector("aside video"),
    player = h.document.querySelector("#playerWrap"),
    video = player.querySelector("video");
  assert.equal(video.playbackRate, 2);
  assert.equal(preview.playbackRate, 1.25);
  h.document.fullscreenElement = player;
  h.document.dispatchEvent(new h.window.Event("fullscreenchange"));
  const progress = h.document.querySelector(
    '[data-bcx-widget="fullscreen-progress"]',
  );
  sameNode(progress.parentElement, player);
  progress.remove();
  h.advance(1200);
  sameNode(
    h.document.querySelector('[data-bcx-widget="fullscreen-progress"]'),
    progress,
  );
  sameNode(progress.parentElement, player);
  h.state.patch("player.speedEnabled", false);
  h.state.patch("player.fullscreenProgress", false);
  assert.equal(
    h.document.querySelector('[data-bcx-widget="fullscreen-progress"]'),
    null,
  );
});

test("speed controls wait for the native menu without placing a bar below the player", async () => {
  const h = await harness(
      { player: { speedEnabled: true, speed: 1.5 } },
      fixture.replace(speedMenuMarkup, ""),
    ),
    player = h.document.querySelector("#playerWrap"),
    desc = h.document.querySelector("#v_desc");
  assert(
    !speedHost(h),
    "a missing native menu should not create standalone controls",
  );
  sameNode(player.nextElementSibling, desc);
  assert.equal(player.querySelector("video").playbackRate, 1.5);
  h.advance(2400);
  assert.equal(speedHost(h), null);
  const fragment = h.document.createElement("div");
  fragment.innerHTML = speedMenuMarkup;
  player
    .querySelector(".bpx-player-control-bottom-right")
    .append(fragment.firstElementChild);
  h.advance(1200);
  assertInMenu(h, player);
  sameNode(player.nextElementSibling, desc);
  assert.equal(
    h.document.querySelectorAll('[data-bcx-widget="speed"]').length,
    1,
  );
});

test("native menu replacement reuses the slider, updates the native rate label and restores native items on disable", async () => {
  const h = await harness({ player: { speedEnabled: true, speed: 1.5 } }),
    player = h.document.querySelector("#playerWrap"),
    originalMenu = player.querySelector(".bpx-player-ctrl-playbackrate-menu"),
    originalStyle = originalMenu.getAttribute("style"),
    host = speedHost(h),
    range = host.querySelector("input[type=range]"),
    label = player.querySelector(".bpx-player-ctrl-playbackrate-result");
  assertInMenu(h, player);
  assert.equal(range.getAttribute("min"), "0.1");
  assert.equal(range.getAttribute("max"), "5");
  assert.equal(range.getAttribute("step"), "0.01");
  assert.equal(host.style.getPropertyValue("--bcx-rate-menu-height"), "198px");
  assert.equal(label.textContent, "1.5x");
  assert.equal(host.querySelector('[aria-pressed="true"]').textContent, "1.5x");
  const mutations = [],
    observer = new h.window.MutationObserver((records) =>
      mutations.push(...records),
    );
  observer.observe(player, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
  h.advance(6000);
  await new Promise(setImmediate);
  observer.disconnect();
  assert.equal(
    mutations.length,
    0,
    "stable scans must not rewrite the native menu",
  );
  const replacement = originalMenu.cloneNode(true);
  for (const node of replacement.querySelectorAll('[data-bcx-widget="speed"]'))
    node.remove();
  replacement.removeAttribute("data-bcx-speed-menu");
  replacement.style.width = "72px";
  const nativeItems = [
    ...replacement.querySelectorAll(".bpx-player-ctrl-playbackrate-menu-item"),
  ];
  originalMenu.replaceWith(replacement);
  h.advance(1200);
  assertInMenu(h, player);
  sameNode(
    speedHost(h),
    host,
    "menu reconstruction should reuse live controls",
  );
  assert.equal(originalMenu.getAttribute("style"), originalStyle);
  assert(!originalMenu.hasAttribute("data-bcx-speed-menu"));
  const rebuiltLabel = label.cloneNode(true);
  rebuiltLabel.textContent = "倍速";
  label.replaceWith(rebuiltLabel);
  h.advance(1200);
  assert.equal(rebuiltLabel.textContent, "1.5x");
  range.value = "1.37";
  range.dispatchEvent(new h.window.Event("input", { bubbles: true }));
  assert.equal(player.querySelector("video").playbackRate, 1.37);
  assert.equal(rebuiltLabel.textContent, "1.37x");
  range.value = "1";
  range.dispatchEvent(new h.window.Event("input", { bubbles: true }));
  assert.equal(rebuiltLabel.textContent, "倍速");
  assert.equal(host.querySelector('[aria-pressed="true"]').textContent, "1x");
  h.state.patch("player.speedEnabled", false);
  assert.equal(speedHost(h), null);
  assert(!replacement.hasAttribute("data-bcx-speed-menu"));
  assert.equal(replacement.style.width, "72px");
  assert.equal(rebuiltLabel.textContent, "倍速");
  assert.equal(h.document.querySelector("[data-bcx-speed-style]"), null);
  assert.equal(replacement.children.length, nativeItems.length);
  for (const item of nativeItems) sameNode(item.parentElement, replacement);
  h.advance(2400);
  assert.equal(speedHost(h), null);
});
