"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const C = require("../extension/common/config.js");
const root = path.resolve(__dirname, "..");
const plain = (value) => JSON.parse(JSON.stringify(value));

function background(initial = {}) {
  const stored = structuredClone(initial),
    requests = [],
    listeners = {};
  let opened = 0;
  const runtime = {
    id: "test-extension",
    onInstalled: { addListener: (fn) => (listeners.install = fn) },
    onMessage: { addListener: (fn) => (listeners.message = fn) },
    openOptionsPage: async () => {
      opened++;
    },
  };
  const context = vm.createContext({
    chrome: {
      runtime,
      storage: {
        local: {
          get: async () => ({ ...stored }),
          set: async (values) => Object.assign(stored, plain(values)),
          remove: async (keys) => {
            for (const key of keys) delete stored[key];
          },
        },
      },
    },
    importScripts() {},
    BiliConfig: C,
    URL,
    AbortSignal,
    fetch: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({ code: 0, data: { title: "fixture" } }),
      };
    },
  });
  vm.runInContext(
    fs.readFileSync(path.join(root, "extension/background.js"), "utf8"),
    context,
  );
  async function send(
    message,
    sender = { id: runtime.id, frameId: 0, url: "https://www.bilibili.com/" },
  ) {
    let response;
    const pending = listeners.message(message, sender, (value) => {
      response = plain(value);
    });
    await new Promise(setImmediate);
    return { pending, response };
  }
  return {
    stored,
    requests,
    install: listeners.install,
    send,
    opened: () => opened,
  };
}

test("upgrading an enabled assistant preserves browser preferences and background while deleting retired data", async () => {
  const h = background({
    biliSettings: {
      ai: { enabled: true, provider: "codex", autoSummary: true },
      player: { speedEnabled: true, speed: 2.5 },
      filter: { titleKeywords: ["spoiler"] },
      appearance: {
        theme: "dark",
        favoriteFeatureIds: ["ai.enabled", "home.preview"],
      },
    },
    localBackground: { dataUrl: "data:image/webp;base64,AAAA" },
    "ai:chat:old": {},
    "transcript:old": {},
    "summary:old": {},
    lastSummary: {},
    diagnostics: [],
    biliStats: {},
    assistantPanelHeight: 500,
    unrelated: "preserved",
  });
  await h.install();
  assert.equal(h.stored.biliSettings.ai, undefined);
  assert.equal(h.stored.biliSettings.player.speed, 2.5);
  assert.equal(h.stored.biliSettings.player.speedEnabled, true);
  assert.deepEqual(h.stored.biliSettings.filter.titleKeywords, ["spoiler"]);
  assert.deepEqual(h.stored.biliSettings.appearance.favoriteFeatureIds, [
    "home.preview",
  ]);
  assert(h.stored.localBackground);
  assert.equal(h.stored.unrelated, "preserved");
  assert.deepEqual(Object.keys(h.stored).sort(), [
    "biliSettings",
    "localBackground",
    "unrelated",
  ]);
  assert.equal(h.requests.length, 0);
  await h.install();
  assert.equal(h.stored.biliSettings.player.speed, 2.5);
});

test("legacy backups ignore removed AI fields without losing valid browser settings", () => {
  const config = C.restore({
    format: "bilibili-codex-settings",
    version: 2,
    settings: {
      ai: { enabled: true, provider: "removed-provider" },
      home: { history: true },
      layout: { rightComments: true, commentWidthPx: 515 },
    },
  });
  assert.equal(config.ai, undefined);
  assert.equal(config.home.history, true);
  assert.equal(config.layout.commentWidthPx, 515);
  assert(!Object.hasOwn(C.backup(config).settings, "ai"));
});

test("retired AI messages and untrusted senders cannot initiate requests", async () => {
  const h = background();
  for (const type of [
    "summarize",
    "chat",
    "ads",
    "polish",
    "subtitles",
    "check",
    "setup-local-model",
    "saved-seconds",
  ])
    assert.equal((await h.send({ type })).pending, undefined);
  const request = { type: "bili-api", task: "view", bvid: "BV1ph4y1c7kp" };
  for (const sender of [
    { id: "other", frameId: 0, url: "https://www.bilibili.com/" },
    { id: "test-extension", frameId: 1, url: "https://www.bilibili.com/" },
    {
      id: "test-extension",
      frameId: 0,
      url: "https://www.bilibili.com.attacker.invalid/",
    },
    { id: "test-extension", frameId: 0, url: "http://www.bilibili.com/" },
  ])
    assert.equal((await h.send(request, sender)).pending, undefined);
  assert.equal(h.requests.length, 0);
  assert.equal(
    (await h.send({ ...request, task: "https://attacker.invalid" })).pending,
    undefined,
  );
  const result = await h.send(request);
  assert.equal(result.response.ok, true);
  assert.equal(h.requests.length, 1);
  assert.equal(
    h.requests[0].url,
    "https://api.bilibili.com/x/web-interface/view?bvid=BV1ph4y1c7kp",
  );
  assert.equal(h.requests[0].options.redirect, "error");
});

test("published source has no assistant runtime, native permission or model installer", () => {
  const manifest = require("../extension/manifest.json");
  assert.deepEqual(manifest.permissions, ["storage"]);
  for (const entry of manifest.content_scripts)
    assert(
      entry.js.every((name) => !["content.js", "subtitles.js"].includes(name)),
    );
  const files = require("../scripts/source-files.cjs").sourceFiles(root);
  assert(
    !files.some((name) =>
      /^(native\/|extension\/setup\/)|local-ai|bootstrap-node|本机桥接|本机转写/.test(
        name,
      ),
    ),
  );
  for (const page of ["popup", "options"])
    assert(
      !/配置本机|定位 AI|文字分析服务/.test(
        fs.readFileSync(path.join(root, "extension", page + ".html"), "utf8"),
      ),
    );
});

test("independent image validation supports CDN previews and rejects unsafe destinations", () => {
  const F = require("../extension/features/runtime.js");
  assert.equal(
    F.cdnUrl("//i0.hdslb.com/cover.jpg"),
    "https://i0.hdslb.com/cover.jpg",
  );
  for (const url of [
    "javascript:alert(1)",
    "http://i0.hdslb.com/a.jpg",
    "https://i0.hdslb.com.evil.invalid/a.jpg",
    "https://user@i0.hdslb.com/a.jpg",
    "https://i0.hdslb.com:444/a.jpg",
  ])
    assert.throws(() => F.cdnUrl(url));
});
