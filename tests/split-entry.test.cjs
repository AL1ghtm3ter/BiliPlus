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
const barMarkup =
  '<div class="bpx-player-control-bottom-right"><span class="bpx-player-ctrl-pip"></span></div>';
const fixture =
  '<main id="mirror-vdcon"><div class="left-container"><h1>视频</h1><div id="playerWrap"><video></video>' +
  barMarkup +
  '</div><div id="v_desc">简介</div><div id="commentapp">评论</div></div><aside class="right-container"></aside></main>';
const settle = async () => {
  for (let i = 0; i < 3; i++) await new Promise(setImmediate);
};
async function harness(settings = {}, html = fixture) {
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
    listeners = [],
    writes = [];
  let now = 0,
    serial = 0;
  const schedule = (fn, delay = 0, repeat = false) => {
    const id = ++serial;
    timers.set(id, { fn, due: now + delay, delay, repeat });
    return id;
  };
  function advance(ms) {
    const until = now + ms;
    let count = 0;
    while (true) {
      const entry = [...timers].sort((a, b) => a[1].due - b[1].due)[0];
      if (!entry || entry[1].due > until) break;
      assert(++count < 500, "scans and restarts must settle");
      const [id, timer] = entry;
      now = timer.due;
      if (timer.repeat) timer.due += timer.delay;
      else timers.delete(id);
      timer.fn();
    }
    now = until;
  }
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
    setTimeout: (fn, delay) => schedule(fn, delay),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, delay) => schedule(fn, delay, true),
    clearInterval: (id) => timers.delete(id),
    console,
  });
  for (const file of [
    "common/config.js",
    "features/runtime.js",
    "features/layout.js",
    "features/index.js",
  ])
    vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, {
      filename: file,
    });
  await settle();
  return {
    window,
    document,
    location,
    writes,
    advance,
    state: context.BiliFeatures.context,
    intervals: () => [...timers.values()].filter((t) => t.repeat).length,
  };
}
const host = (h) =>
  h.document.querySelector('[data-bcx-widget="split-control"]');
const button = (h) => host(h)?.shadowRoot.querySelector("button");

test("default playback shows a small native split entry while leaving video and comments in their original layout", async () => {
  const h = await harness(),
    control = host(h);
  assert(control, "default split=false must still expose the playback entry");
  assert.equal(
    control.parentElement.className,
    "bpx-player-control-bottom-right",
  );
  assert.equal(button(h).getAttribute("aria-pressed"), "false");
  assert.equal(h.document.querySelector("[data-bcx-split]"), null);
  assert.equal(
    h.document.querySelector("#commentapp").parentElement.className,
    "left-container",
  );
  assert.equal(
    h.document.documentElement.hasAttribute("data-bcx-wide-layout"),
    false,
  );
  assert.equal(
    h.intervals(),
    1,
    "inactive entry must not add a permanent polling interval",
  );
});

test("one click from defaults enables split and a second click restores video and comments without removing the entry", async () => {
  const h = await harness(),
    player = h.document.querySelector("#playerWrap"),
    comments = h.document.querySelector("#commentapp"),
    parent = player.parentElement;
  let nativeClicks = 0;
  player
    .querySelector(".bpx-player-control-bottom-right")
    .addEventListener("click", () => nativeClicks++);
  assert(button(h), "split entry should be ready");
  button(h).click();
  await settle();
  assert.equal(
    nativeClicks,
    0,
    "the split action must not trigger native player click actions",
  );
  assert.equal(h.state.settings().layout.split, true);
  assert.equal(h.state.settings().layout.splitActive, true);
  assert.equal(player.parentElement.getAttribute("data-bcx-left"), "1");
  assert(comments.closest('[data-bcx-pane="comments"]'));
  assert.equal(button(h).getAttribute("aria-pressed"), "true");
  h.advance(600);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].biliSettings.layout.split, true);
  button(h).click();
  await settle();
  assert.equal(h.document.querySelector("[data-bcx-split]"), null);
  assert.equal(player.parentElement, parent);
  assert.equal(comments.parentElement, parent);
  assert.equal(button(h).getAttribute("aria-pressed"), "false");
  assert.equal(
    h.document.querySelectorAll('[data-bcx-widget="split-control"]').length,
    1,
  );
  h.advance(6000);
  assert.equal(h.document.querySelector("[data-bcx-split]"), null);
});

test("an old saved split=false and splitActive=false state opens with one entry click and saves both choices", async () => {
  const h = await harness({ layout: { split: false, splitActive: false } });
  assert(button(h));
  button(h).click();
  await settle();
  h.advance(600);
  assert.equal(h.state.settings().layout.split, true);
  assert.equal(h.state.settings().layout.splitActive, true);
  assert(h.document.querySelector("[data-bcx-split]"));
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].biliSettings.layout.splitActive, true);
});

test("a late or replaced native player control bar receives one reusable entry even while split is disabled", async () => {
  const h = await harness({}, fixture.replace(barMarkup, ""));
  assert.equal(host(h), null);
  const player = h.document.querySelector("#playerWrap");
  player.insertAdjacentHTML("beforeend", barMarkup);
  await settle();
  assert(button(h), "late native controls must gain the entry");
  const original = host(h),
    oldBar = original.parentElement,
    newBar = oldBar.cloneNode(true);
  newBar.querySelector("[data-bcx-widget]")?.remove();
  oldBar.replaceWith(newBar);
  await settle();
  assert.equal(host(h), original);
  assert.equal(original.parentElement, newBar);
  assert.equal(
    h.document.querySelectorAll('[data-bcx-widget="split-control"]').length,
    1,
  );
});

test("leaving playback cleans the entry and stale callbacks cannot reattach or activate split", async () => {
  const h = await harness(),
    stale = button(h);
  assert(stale);
  h.location.pathname = "/";
  h.advance(1000);
  await settle();
  assert.equal(host(h), null);
  assert.equal(h.intervals(), 1);
  stale.click();
  h.advance(600);
  await settle();
  assert.equal(h.state.settings().layout.split, false);
  assert.equal(h.writes.length, 0);
  h.document
    .querySelector("#playerWrap")
    .insertAdjacentHTML("beforeend", barMarkup);
  await settle();
  assert.equal(host(h), null);
});

test("explicit settings disable restores an active layout while keeping the same default entry behavior", async () => {
  const h = await harness({
    layout: { split: true, splitActive: true, highlightControlButton: false },
  });
  assert(h.document.querySelector("[data-bcx-split]"));
  assert.equal(
    button(h).getAttribute("aria-pressed"),
    "true",
    "pressed semantics cannot depend on decorative highlight",
  );
  h.state.patch("layout.split", false);
  await settle();
  assert.equal(h.document.querySelector("[data-bcx-split]"), null);
  assert.equal(
    h.document.querySelector("#playerWrap").parentElement.className,
    "left-container",
  );
  assert(button(h));
  assert.equal(button(h).getAttribute("aria-pressed"), "false");
});
