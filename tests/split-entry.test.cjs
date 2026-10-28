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

const legacyLayout = {
  split: true,
  splitActive: true,
  sideWidth: 52,
  sideWidthPx: 720,
  activeTab: "ai",
  highlightControlButton: true,
};
const absentSplit = (h) => {
  assert(
    h.document.querySelector('[data-bcx-widget="split-control"]') === null,
  );
  assert(h.document.querySelector("[data-bcx-split]") === null);
  assert(h.document.querySelector("[data-bcx-tabs]") === null);
  assert(h.document.querySelector("[data-bcx-pane]") === null);
};
test("default playback has no split control or layout and leaves native player, comments and controls intact", async () => {
  const h = await harness();
  absentSplit(h);
  assert.equal(
    h.document.querySelector("#playerWrap").parentElement.className,
    "left-container",
  );
  assert.equal(
    h.document.querySelector("#commentapp").parentElement.className,
    "left-container",
  );
  assert.equal(
    h.document.querySelector(".bpx-player-control-bottom-right").children
      .length,
    1,
  );
  assert.equal(
    h.document.documentElement.hasAttribute("data-bcx-wide-layout"),
    false,
  );
  assert.equal(
    h.intervals(),
    1,
    "disabled right comments adds no observer or polling interval",
  );
});
test("legacy split=true settings cannot create controls or move native nodes even after page mutations and restarts", async () => {
  const h = await harness({ layout: legacyLayout });
  absentSplit(h);
  const player = h.document.querySelector("#playerWrap");
  player.insertAdjacentHTML("beforeend", barMarkup);
  await settle();
  h.advance(6000);
  h.state.patch("player.step", 0.5);
  await settle();
  absentSplit(h);
  assert.equal(player.parentElement.className, "left-container");
  assert.equal(
    h.document.querySelector("#commentapp").parentElement.className,
    "left-container",
  );
  assert.equal(h.intervals(), 1);
});
test("normalization and old backup restore discard retired split fields and favorites while keeping independent layout choices", () => {
  const C = require("../extension/common/config.js"),
    fields = require("../extension/common/settings-fields.js");
  const old = {
    layout: { ...legacyLayout, rightComments: true, commentWidthPx: 515 },
    home: { minimal: true },
    appearance: {
      favoriteFeatureIds: [
        "layout.split",
        "layout.rightComments",
        "home.minimal",
      ],
    },
  };
  const restored = C.restore({
    format: "bilibili-codex-settings",
    version: 2,
    settings: old,
  });
  assert.deepEqual(restored.layout, {
    rightComments: true,
    commentWidthPx: 515,
  });
  assert.equal(restored.home.minimal, true);
  assert.deepEqual(restored.appearance.favoriteFeatureIds, [
    "layout.rightComments",
    "home.minimal",
  ]);
  assert.deepEqual(C.backup(restored).settings.layout, restored.layout);
  for (const key of Object.keys(legacyLayout)) {
    C.set(restored, "layout." + key, legacyLayout[key]);
    assert.equal(
      Object.hasOwn(restored.layout, key),
      false,
      key + " cannot be reintroduced through setters",
    );
  }
  assert.equal(
    C.CATALOG.flatMap((group) => group.items).some(
      (item) => item[0] === "layout.split",
    ),
    false,
  );
  const keys = Object.values(fields)
    .flat()
    .map((field) => field.key);
  for (const key of Object.keys(legacyLayout))
    assert.equal(keys.includes("layout." + key), false);
  assert(keys.includes("layout.commentWidthPx"));
  assert.equal(
    C.normalize({ layout: { commentWidthPx: 1 } }).layout.commentWidthPx,
    300,
  );
  assert.equal(
    C.normalize({ layout: { commentWidthPx: 1000 } }).layout.commentWidthPx,
    800,
  );
});
test("old backups can still independently enable right comments without split controls, tabs or unrelated sidebar moves", async () => {
  const h = await harness({
      layout: { ...legacyLayout, rightComments: true, commentWidthPx: 515 },
    }),
    comments = h.document.querySelector("#commentapp"),
    player = h.document.querySelector("#playerWrap");
  absentSplit(h);
  assert(comments.closest("[data-bcx-right-comments]"));
  assert.equal(
    h.document
      .querySelector("[data-bcx-right-comments]")
      .querySelectorAll("[role=tab]").length,
    0,
  );
  assert.equal(
    h.document
      .querySelector("[data-bcx-comment-column]")
      .getAttribute("aria-label"),
    "评论",
  );
  h.state.patch("layout.rightComments", false);
  await settle();
  assert.equal(h.document.querySelector("[data-bcx-right-comments]"), null);
  assert.equal(comments.parentElement.className, "left-container");
  assert.equal(player.nextElementSibling.id, "v_desc");
  absentSplit(h);
});
test("late or replaced player control bars remain free of split controls before and after route changes", async () => {
  const h = await harness(
      { layout: legacyLayout },
      fixture.replace(barMarkup, ""),
    ),
    player = h.document.querySelector("#playerWrap");
  player.insertAdjacentHTML("beforeend", barMarkup);
  await settle();
  const bar = player.querySelector(".bpx-player-control-bottom-right");
  bar.replaceWith(bar.cloneNode(true));
  await settle();
  absentSplit(h);
  h.location.pathname = "/";
  h.advance(1000);
  await settle();
  absentSplit(h);
  assert.equal(h.document.querySelector("[data-bcx-right-comments]"), null);
  assert.equal(h.writes.length, 0);
});

for (const railClass of ["right-container", "playlist-container--right"])
  test(`right comments keeps the subtitle assistant and native ${railClass} visible across restarts`, async () => {
    const html = fixture.replace(
        '<aside class="right-container"></aside>',
        `<aside class="${railClass}"><div class="up-panel-container">UP</div><div id="bili-codex-root">字幕助手</div><div id="danmukuBox">弹幕</div></aside>`,
      ),
      h = await harness({ layout: { rightComments: true } }, html),
      panel = h.document.querySelector("#bili-codex-root"),
      rail = panel.parentElement;
    function assertVisible() {
      const ancestors = [];
      for (let node = panel; node; node = node.parentElement)
        ancestors.push(node);
      for (const style of h.document.querySelectorAll("style")) {
        for (const rule of style.sheet.cssRules) {
          if (!rule.selectorText || rule.style.display !== "none") continue;
          for (const node of ancestors)
            assert.equal(
              node.matches(rule.selectorText),
              false,
              "right comments must not hide the assistant through " +
                rule.selectorText,
            );
        }
      }
      assert.equal(panel.parentElement, rail);
      assert.equal(panel.isConnected, true);
      assert.equal(rail.querySelector("#danmukuBox").isConnected, true);
    }
    assertVisible();
    h.state.patch("layout.commentWidthPx", 515);
    await settle();
    assertVisible();
    h.state.patch("layout.rightComments", false);
    await settle();
    assertVisible();
    assert.equal(
      h.document.querySelector("#playerWrap").parentElement.className,
      "left-container",
    );
    assert.equal(
      h.document.querySelector("#commentapp").parentElement.className,
      "left-container",
    );
  });
