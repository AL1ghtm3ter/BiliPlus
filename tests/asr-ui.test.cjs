"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  crypto = require("node:crypto"),
  { parseHTML } = require("linkedom");
const root = path.resolve(
  process.env.BILI_TEST_SOURCE_ROOT || path.join(__dirname, ".."),
);
const flush = () => new Promise(setImmediate);
function event() {
  const callbacks = [];
  return {
    addListener: (fn) => callbacks.push(fn),
    fire: (...args) => callbacks.forEach((fn) => fn(...args)),
  };
}
async function panel(provider = "local", layout = {}) {
  const { window, document } = parseHTML(
    '<html><head></head><body><h1>合成字幕测试</h1><div id="playerWrap"><video></video><div class="bpx-player-control-bottom-right"></div></div><div id="commentapp"><bili-comments></bili-comments></div><aside class="right-container"><div class="right-container-inner scroll-sticky"><div class="up-panel-container">UP</div><div id="danmukuBox">弹幕</div></div></aside></body></html>',
  );
  document.readyState = "complete";
  const location = {
      hostname: "www.bilibili.com",
      pathname: "/video/BV1ph4y1c7kp/",
      search: "",
      href: "https://www.bilibili.com/video/BV1ph4y1c7kp/",
    },
    storage = { biliSettings: { ai: { enabled: true, provider }, layout } },
    ports = [],
    timers = new Map();
  let serial = 0;
  window.location = location;
  const chrome = {
    storage: {
      onChanged: event(),
      local: {
        get: async (key) => (key ? { [key]: storage[key] } : { ...storage }),
        set: async (values) => Object.assign(storage, values),
        remove: async (key) => delete storage[key],
      },
    },
    runtime: {
      getURL: (name) => "chrome-extension://test/" + name,
      onMessage: event(),
      sendMessage: async () => ({}),
      connect: () => {
        const port = {
          onMessage: event(),
          onDisconnect: event(),
          sent: [],
          postMessage(message) {
            port.sent.push(message);
          },
          disconnect() {},
        };
        ports.push(port);
        return port;
      },
    },
  };
  const context = vm.createContext({
    window,
    top: window,
    document,
    location,
    chrome,
    URL,
    crypto: crypto.webcrypto,
    navigator: { clipboard: { writeText: async () => {} } },
    CustomEvent: window.CustomEvent,
    Event: window.Event,
    console,
    setTimeout: (fn) => (timers.set(++serial, fn), serial),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn) => (timers.set(++serial, fn), serial),
    clearInterval: (id) => timers.delete(id),
  });
  for (const file of [
    "common/config.js",
    "features/runtime.js",
    "features/layout.js",
    "features/index.js",
  ])
    vm.runInContext(
      fs.readFileSync(path.join(root, "extension", file), "utf8"),
      context,
    );
  await flush();
  const video = document.querySelector("video");
  video.duration = 70;
  video.currentTime = 0;
  video.paused = true;
  window.addEventListener("bili-codex-request", (event) =>
    window.dispatchEvent(
      new window.CustomEvent("bili-codex-snapshot", {
        detail: JSON.stringify({
          id: JSON.parse(event.detail).id,
          bvid: "BV1ph4y1c7kp",
          cid: "1",
          duration: 70,
        }),
      }),
    ),
  );
  vm.runInContext(
    fs.readFileSync(path.join(root, "extension/content.js"), "utf8"),
    context,
  );
  const shadow = document.querySelector("#bili-codex-root").shadowRoot,
    $ = (selector) => shadow.querySelector(selector);
  async function click(selector) {
    $(selector).click();
    await flush();
  }
  function reply(result, kind, source, cached = false) {
    const port = ports.at(-1),
      id = port.sent[0].id;
    if (source)
      port.onMessage.fire({
        id,
        type: "progress",
        stage: "connecting",
        source,
      });
    port.onMessage.fire({
      id,
      type: "result",
      result,
      meta: { kind, source, cached, subtitleCount: 1, provider },
    });
  }
  async function captions(source) {
    await click(".read");
    reply(
      {
        subtitles: [{ start: 0, end: 3, text: "合成字幕" }],
        source,
        language: "中文",
      },
      "subtitles",
      source,
      true,
    );
  }
  async function setProvider(next) {
    const previous = storage.biliSettings;
    storage.biliSettings = {
      ...previous,
      ai: { ...previous.ai, provider: next },
    };
    chrome.storage.onChanged.fire(
      { biliSettings: { oldValue: previous, newValue: storage.biliSettings } },
      "local",
    );
    await flush();
  }
  return {
    $,
    shadow,
    document,
    window,
    click,
    reply,
    captions,
    setProvider,
    provider: () => context.BiliFeatures.context.settings().ai.provider,
  };
}
const analysisText = (provider) =>
  provider === "codex" ? "文字分析：Codex（线上）" : "文字分析：本机模型";

for (const provider of ["local", "codex"]) {
  test(`${provider} unread captions keep local Whisper explanation while analysis tabs name the text service`, async () => {
    const h = await panel(provider);
    assert.equal(
      h.$(".engine-note").textContent,
      "无字幕时使用本机 Whisper 转写",
    );
    assert.equal(h.$(".source-note").hidden, true);
    for (const tab of ["summary", "chat", "ads"]) {
      await h.click(`[data-tab="${tab}"]`);
      assert.equal(h.$(".engine-note").textContent, analysisText(provider));
    }
    await h.click('[data-tab="subtitles"]');
    assert.equal(
      h.$(".engine-note").textContent,
      "无字幕时使用本机 Whisper 转写",
    );
  });

  for (const source of ["official", "local-asr"]) {
    test(`${provider} cached ${source} captions show actual subtitle source across tab changes`, async () => {
      const h = await panel(provider);
      await h.captions(source);
      const expected =
        source === "official"
          ? "B站已有字幕（未调用识别模型）"
          : "本机 Whisper 转写";
      assert.equal(h.$(".engine-note").textContent, expected);
      assert.equal(h.$(".source-note").hidden, true);
      assert(!h.$(".engine-note").textContent.includes("Codex"));
      await h.click('[data-tab="summary"]');
      assert.equal(h.$(".engine-note").textContent, analysisText(provider));
      assert.equal(h.$(".source-note").hidden, false);
      assert.match(
        h.$(".source-note").textContent,
        source === "official" ? /B站已有字幕/ : /本机 Whisper/,
      );
      await h.click('[data-tab="subtitles"]');
      assert.equal(h.$(".engine-note").textContent, expected);
    });
  }

  test(`${provider} polished article identifies text analysis while retaining the transcript source`, async () => {
    const h = await panel(provider);
    await h.captions("local-asr");
    await h.click(".polish");
    assert.equal(h.$(".engine-note").textContent, analysisText(provider));
    h.reply({ article: "按本机转写文字整理的文章" }, "polish", "local-asr");
    assert.equal(h.$(".article-area").hidden, false);
    assert.equal(h.$(".engine-note").textContent, analysisText(provider));
    assert.match(h.$(".source-note").textContent, /本机 Whisper/);
    assert.equal(h.$(".source-note").hidden, false);
    assert.equal(h.$(".transcript-meta").textContent, "1 条 · 本机识别");
  });

  test(`${provider} chat author and cache-miss wording do not falsely claim a Codex call`, async () => {
    const h = await panel(provider);
    await h.click('[data-tab="chat"]');
    h.$("#question").value = "测试问题";
    h.$(".question-form").dispatchEvent(
      new h.window.Event("submit", { bubbles: true, cancelable: true }),
    );
    await flush();
    h.reply({ answer: "测试答复", references: [] }, "chat", "official");
    assert.equal(h.$(".chat-message.assistant strong").textContent, "助手");
    await h.click('[data-tab="ads"]');
    await h.click(".detect");
    h.reply({ segments: [], cacheMiss: true }, "ads", "official", true);
    assert.match(h.$(".ads-result").textContent, /本次未调用文字模型/);
    assert(!h.$(".ads-result").textContent.includes("Codex"));
  });
}

test("text-service changes update the currently visible footer without requiring a tab change", async () => {
  const h = await panel("local");
  await h.click('[data-tab="summary"]');
  assert.equal(h.$(".engine-note").textContent, analysisText("local"));
  await h.setProvider("codex");
  assert.equal(
    h.provider(),
    "codex",
    "the actual feature settings must update",
  );
  assert.equal(h.$(".engine-note").textContent, analysisText("codex"));
  await h.click('[data-tab="subtitles"]');
  await h.captions("local-asr");
  await h.setProvider("local");
  assert.equal(h.$(".engine-note").textContent, "本机 Whisper 转写");
});

test("obsolete split preferences cannot recreate split controls after actual layout/index/content startup", async () => {
  const h = await panel("local", { split: true, splitButton: true });
  await h.setProvider("codex");
  for (const tree of [h.document, h.shadow]) {
    assert.equal(tree.querySelector("[data-bcx-split-control]"), null);
    assert.equal(tree.querySelector("[data-bcx-split-shell]"), null);
    assert(
      [...tree.querySelectorAll("button,[role=tab]")].every(
        (button) =>
          !/分屏/.test(button.textContent + button.getAttribute("title")),
      ),
    );
  }
});
