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
const summary = {
  summary: "按照字幕总结的方法。",
  keyPoints: ["先计划再执行"],
  segments: [
    { start: 12, end: 35, title: "方法", summary: "第一步选择任务。" },
  ],
};
function event() {
  const fns = [];
  return {
    addListener: (fn) => fns.push(fn),
    fire: (...args) => fns.map((fn) => fn(...args)),
  };
}
async function panel(ai = {}) {
  const { window, document } = parseHTML(
    '<html><head></head><body><h1>测试视频</h1><div id="playerWrap"><video></video><div class="bpx-player-progress-wrap"></div></div><aside class="right-container"><div class="right-container-inner scroll-sticky"><div class="up-panel-container">UP</div><div id="danmukuBox">弹幕</div></div></aside></body></html>',
  );
  document.readyState = "complete";
  const location = {
    hostname: "www.bilibili.com",
    pathname: "/video/BV1ph4y1c7kp/",
    search: "",
    href: "https://www.bilibili.com/video/BV1ph4y1c7kp/",
  };
  window.location = location;
  const timers = new Map(),
    ports = [],
    messages = [],
    copied = [],
    downloads = [],
    blobs = new Map(),
    store = { biliSettings: { ai: { enabled: true, ...ai } } };
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
  function advance(ms) {
    const end = now + ms;
    let n = 0;
    while (true) {
      const item = [...timers].sort((a, b) => a[1].due - b[1].due)[0];
      if (!item || item[1].due > end) break;
      assert(++n < 2000);
      const [id, t] = item;
      now = t.due;
      if (t.repeat) t.due += t.delay;
      else timers.delete(id);
      t.fn();
    }
    now = end;
  }
  class TestURL extends URL {
    static createObjectURL(blob) {
      const key = "blob:test-" + (blobs.size + 1);
      blobs.set(key, blob);
      return key;
    }
    static revokeObjectURL() {}
  }
  const create = document.createElement.bind(document);
  document.createElement = (name, ...args) => {
    const node = create(name, ...args);
    if (name === "a")
      node.click = () =>
        downloads.push({
          name: node.getAttribute("download"),
          blob: blobs.get(node.getAttribute("href")),
        });
    return node;
  };
  const chrome = {
    runtime: {
      getURL: (p) => "chrome-extension://test/" + p,
      onMessage: event(),
      sendMessage: async (m) => (messages.push(m), {}),
      connect: () => {
        const p = {
          onMessage: event(),
          onDisconnect: event(),
          sent: [],
          disconnected: false,
          postMessage(m) {
            p.sent.push(m);
          },
          disconnect() {
            p.disconnected = true;
            p.onDisconnect.fire();
          },
        };
        ports.push(p);
        return p;
      },
    },
    storage: {
      onChanged: event(),
      local: {
        get: async (key) => (key ? { [key]: store[key] } : { ...store }),
        set: async (value) => Object.assign(store, value),
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
    URL: TestURL,
    Blob,
    CustomEvent: window.CustomEvent,
    Event: window.Event,
    Date: ClockDate,
    crypto: crypto.webcrypto,
    navigator: { clipboard: { writeText: async (text) => copied.push(text) } },
    console,
    setTimeout: (f, d) => schedule(f, d),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (f, d) => schedule(f, d, true),
    clearInterval: (id) => timers.delete(id),
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
  const video = document.querySelector("video");
  video.duration = 120;
  video.currentTime = 0;
  video.paused = false;
  window.addEventListener("bili-codex-request", (e) =>
    window.dispatchEvent(
      new window.CustomEvent("bili-codex-snapshot", {
        detail: JSON.stringify({
          id: JSON.parse(e.detail).id,
          bvid: location.pathname.match(/BV\w{10}/)?.[0],
          cid: "1",
          title: "测试视频",
          duration: video.duration,
          tracks: [
            {
              lan: "zh-CN",
              subtitle_url: "https://aisubtitle.hdslb.com/test.json",
            },
          ],
        }),
      }),
    ),
  );
  vm.runInContext(
    fs.readFileSync(path.join(root, "extension/content.js"), "utf8"),
    context,
    { filename: "content.js" },
  );
  const shadow = document.querySelector("#bili-codex-root").shadowRoot;
  const reply = (result, kind) => {
    const p = ports.at(-1),
      request = p.sent.find((m) => m.type !== "cancel");
    p.onMessage.fire({
      id: request.id,
      type: "result",
      result,
      meta: { kind, subtitleCount: 4, elapsedMs: 10 },
    });
  };
  const click = async (selector) => {
    shadow.querySelector(selector).click();
    await flush();
  };
  const submit = async (question) => {
    shadow.querySelector("#question").value = question;
    shadow
      .querySelector(".question-form")
      .dispatchEvent(
        new window.Event("submit", { bubbles: true, cancelable: true }),
      );
    await flush();
  };
  return {
    window,
    document,
    context,
    location,
    video,
    shadow,
    $: (s) => shadow.querySelector(s),
    ports,
    messages,
    copied,
    downloads,
    store,
    advance,
    reply,
    click,
    submit,
    tick: () => video.dispatchEvent(new window.Event("timeupdate")),
  };
}
test("QA summary renders safe text, key points, chapter seeks and player markers through real index/content startup", async () => {
  const h = await panel();
  await h.click(".start");
  assert.equal(h.ports[0].sent[0].type, "summarize");
  h.reply(
    { ...summary, summary: '<img src=x onerror="bad()">字幕文本' },
    "summary",
  );
  assert.equal(h.$(".summary img"), null);
  assert.match(h.$(".summary").textContent, /<img/);
  assert.equal(h.$(".points li").textContent, "先计划再执行");
  h.$(".seek").click();
  assert.equal(h.video.currentTime, 12);
  const marker = h.document.querySelector('[data-bcx-marker="chapter"]');
  assert(marker);
  h.video.currentTime = 0;
  marker.click();
  assert.equal(h.video.currentTime, 12);
  h.$(".copy").click();
  await flush();
  assert.match(h.copied[0], /方法/);
});
test("QA chat passes prior context, seeks references, and actual video navigation clears conversation", async () => {
  const h = await panel();
  await h.submit("第一问");
  assert.equal(h.ports.at(-1).sent[0].history.length, 0);
  h.reply(
    { answer: "第一答", references: [{ start: 20, label: "依据" }] },
    "chat",
  );
  h.$(".reference").click();
  assert.equal(h.video.currentTime, 20);
  await h.submit("第二问");
  assert.deepEqual(JSON.parse(JSON.stringify(h.ports.at(-1).sent[0].history)), [
    { role: "user", content: "第一问" },
    { role: "assistant", content: "第一答" },
  ]);
  h.reply({ answer: "第二答", references: [] }, "chat");
  h.location.pathname = "/video/BV1ab4y1c7kP/";
  h.location.href = "https://www.bilibili.com" + h.location.pathname;
  h.advance(1200);
  await flush();
  assert.equal(h.$(".chat-log").textContent, "");
  assert.equal(
    h.$('[data-tab="subtitles"]').getAttribute("aria-selected"),
    "true",
  );
  await h.submit("新视频");
  assert.equal(h.ports.at(-1).sent[0].history.length, 0);
});
test("QA copy-current-content follows the chat tab rather than an old summary and disables an unread tab", async () => {
  const h = await panel();
  await h.click(".start");
  h.reply(summary, "summary");
  h.$('[data-tab="chat"]').click();
  assert.equal(
    h.$(".copy").disabled,
    true,
    "an unread chat tab has no current content to copy",
  );
  await h.submit("当前问题");
  h.reply(
    {
      answer: "当前问答的独立答案",
      references: [{ start: 20, label: "问答依据" }],
    },
    "chat",
  );
  assert.equal(h.$(".copy").disabled, false);
  h.$(".copy").click();
  await flush();
  assert.match(h.copied.at(-1), /当前问答的独立答案/);
  assert.doesNotMatch(h.copied.at(-1), /按照字幕总结的方法/);
});
test("QA copy-current-content follows the ad tab rather than an old summary and disables an unread tab", async () => {
  const h = await panel();
  await h.click(".start");
  h.reply(summary, "summary");
  h.$('[data-tab="ads"]').click();
  assert.equal(
    h.$(".copy").disabled,
    true,
    "an unread ad tab has no current content to copy",
  );
  await h.click(".detect");
  h.reply(
    {
      segments: [
        {
          start: 10,
          end: 20,
          label: "测试品牌广告",
          reason: "会员购买引导",
          confidence: 0.95,
        },
      ],
    },
    "ads",
  );
  assert.equal(h.$(".copy").disabled, false);
  h.$(".copy").click();
  await flush();
  assert.match(h.copied.at(-1), /测试品牌广告/);
  assert.match(h.copied.at(-1), /会员购买引导/);
  assert.doesNotMatch(h.copied.at(-1), /按照字幕总结的方法/);
});
test("QA subtitle reader displays every line and exports full SRT TXT JSON while reread bypasses cache", async () => {
  const h = await panel();
  await h.click(".read");
  const subs = Array.from({ length: 205 }, (_, i) => ({
    start: i / 2,
    end: i / 2 + 0.4,
    text: "字幕" + i,
  }));
  h.reply(
    {
      bvid: "BV1ph4y1c7kp",
      cid: "1",
      duration: 120,
      language: "中文",
      source: "official",
      subtitles: subs,
    },
    "subtitles",
  );
  assert.equal(h.shadow.querySelectorAll(".subtitle-line").length, 205);
  assert.match(h.$(".transcript").lastElementChild.textContent, /字幕204/);
  assert.doesNotMatch(h.$(".transcript-meta").textContent, /预览前/);
  assert.match(h.$(".transcript-meta").textContent, /205/);
  for (const format of ["srt", "txt", "json"]) {
    const selector = h.$(".export-format");
    Object.defineProperty(selector, "value", {
      configurable: true,
      writable: true,
      value: format,
    });
    selector.dispatchEvent(new h.window.Event("change"));
    const download = h.downloads.at(-1),
      text = await download.blob.text();
    assert.equal(download.name, "BV1ph4y1c7kp-1." + format);
    assert.match(text, /字幕204/);
    if (format === "json") assert.equal(JSON.parse(text).subtitles.length, 205);
    if (format === "srt") assert.match(text, /00:00:00,000 --> 00:00:00,400/);
  }
  await h.click(".read");
  assert.equal(h.ports.at(-1).sent[0].forceTranscript, true);
});
test("QA polished article renders safely and copies the full article", async () => {
  const h = await panel();
  await h.click(".polish");
  h.reply({ article: "第一段内容。\n\n第二段内容。" }, "polish");
  assert.equal(h.$(".article-area").hidden, false);
  assert.equal(h.shadow.querySelectorAll(".article p").length, 2);
  h.$(".copy-article").click();
  await flush();
  assert.equal(h.copied[0], "第一段内容。\n\n第二段内容。");
});
test("QA ad confidence gate, countdown, keep and saved-seconds messaging behave on the current video", async () => {
  const h = await panel({ skipAds: true, skipCountdown: 2, adThreshold: 0.85 });
  await h.click(".detect");
  h.reply(
    {
      segments: [
        {
          start: 10,
          end: 20,
          label: "测试广告",
          reason: "购买引导",
          confidence: 0.95,
        },
        {
          start: 40,
          end: 50,
          label: "低置信度",
          reason: "模糊依据",
          confidence: 0.6,
        },
      ],
    },
    "ads",
  );
  h.video.currentTime = 11;
  h.tick();
  assert(h.document.querySelector("[data-bcx-ad-notice]"));
  h.advance(1000);
  h.tick();
  assert.equal(h.video.currentTime, 11);
  h.advance(1000);
  h.tick();
  assert.equal(h.video.currentTime, 20.05);
  assert.equal(h.messages.find((m) => m.type === "saved-seconds").seconds, 9);
  h.video.currentTime = 42;
  h.tick();
  assert.equal(h.document.querySelector("[data-bcx-ad-notice]"), null);
  h.video.currentTime = 12;
  h.tick();
  assert.equal(
    h.document.querySelector("[data-bcx-ad-notice]"),
    null,
    "already skipped segment is not skipped twice",
  );
  const other = await panel({ skipAds: true, skipCountdown: 2 });
  await other.click(".detect");
  other.reply(
    {
      segments: [
        { start: 10, end: 20, label: "广告", reason: "赞助", confidence: 0.95 },
      ],
    },
    "ads",
  );
  other.video.currentTime = 12;
  other.tick();
  other.document.querySelector("[data-bcx-ad-notice] button").click();
  other.advance(3000);
  other.tick();
  assert.equal(other.video.currentTime, 12);
  assert.equal(
    other.messages.filter((m) => m.type === "saved-seconds").length,
    0,
  );
});
test("QA pause cancels ad countdown and disabling AI removes notices and markers", async () => {
  const h = await panel({ skipAds: true, skipCountdown: 3 });
  await h.click(".detect");
  h.reply(
    {
      segments: [
        { start: 10, end: 20, label: "广告", reason: "赞助", confidence: 0.99 },
      ],
    },
    "ads",
  );
  h.video.currentTime = 11;
  h.tick();
  h.video.paused = true;
  h.tick();
  assert.equal(h.document.querySelector("[data-bcx-ad-notice]"), null);
  h.advance(5000);
  h.video.paused = false;
  h.tick();
  assert.equal(h.video.currentTime, 11);
  h.context.BiliFeatures.context.patch("ai.enabled", false);
  await flush();
  h.advance(1000);
  assert.equal(h.document.querySelector("#bili-codex-root"), null);
  assert.equal(h.document.querySelector("[data-bcx-ad-notice]"), null);
  assert.equal(h.document.querySelector("[data-bcx-marker]"), null);
});
for (const [setting, type] of [
  ["autoSummary", "summarize"],
  ["autoAds", "ads"],
  ["autoAsr", "subtitles"],
])
  test(`QA ${setting} respects duration gates, fires once, and leaves the selected subtitle tab`, async () => {
    const h = await panel({
      [setting]: true,
      summaryMinDuration: 100,
      summaryMaxDuration: 200,
      adMinDuration: 100,
      adMaxDuration: 200,
      asrMinDuration: 100,
      asrMaxDuration: 200,
    });
    h.video.currentTime = 14;
    h.tick();
    await flush();
    assert.equal(h.ports.length, 0, "nothing automatic before 15 seconds");
    h.video.currentTime = 16;
    h.video.paused = true;
    h.tick();
    await flush();
    assert.equal(
      h.ports.length,
      0,
      "paused video must not trigger a model task",
    );
    h.video.paused = false;
    h.video.duration = 90;
    h.tick();
    await flush();
    assert.equal(h.ports.length, 0);
    h.video.duration = 220;
    h.tick();
    await flush();
    assert.equal(h.ports.length, 0, "maximum duration gate must also apply");
    h.video.duration = 120;
    h.tick();
    await flush();
    assert.equal(h.ports.length, 1);
    assert.equal(h.ports[0].sent[0].type, type);
    assert.equal(
      h.$('[data-tab="subtitles"]').getAttribute("aria-selected"),
      "true",
    );
    h.ports[0].onMessage.fire({
      id: h.ports[0].sent[0].id,
      type: "error",
      error: "测试失败",
    });
    h.tick();
    await flush();
    assert.equal(
      h.ports.length,
      1,
      "automatic task must not loop after failure",
    );
  });
test("QA cancellation disconnects the task and reports cancelled; transport failure enables retry", async () => {
  const h = await panel();
  await h.click(".start");
  h.$(".cancel").click();
  assert.equal(h.ports[0].disconnected, true);
  assert.equal(h.ports[0].sent.at(-1).type, "cancel");
  assert.match(h.$(".status").textContent, /取消/);
  await h.click(".start");
  h.ports[1].onMessage.fire({
    id: h.ports[1].sent[0].id,
    type: "error",
    error: "测试连接失败",
  });
  assert.equal(h.$(".start").disabled, false);
  assert.match(h.$(".error").textContent, /测试连接失败/);
});
test("QA late result from a cancelled task cannot overwrite a new video", async () => {
  const h = await panel();
  await h.click(".start");
  const old = h.ports[0],
    id = old.sent[0].id;
  h.location.pathname = "/video/BV1ab4y1c7kP/";
  h.location.href = "https://www.bilibili.com" + h.location.pathname;
  h.advance(1200);
  await flush();
  assert.equal(old.disconnected, true);
  old.onMessage.fire({
    id,
    type: "result",
    result: summary,
    meta: { kind: "summary" },
  });
  assert.equal(
    h.$(".result").hidden,
    true,
    "late old-video result must not become the new video's result",
  );
  assert.equal(
    h.$('[data-tab="subtitles"]').getAttribute("aria-selected"),
    "true",
  );
});
test("QA cancelled task's queued result stays cancelled", async () => {
  const h = await panel();
  await h.click(".start");
  const old = h.ports[0],
    id = old.sent[0].id;
  h.$(".cancel").click();
  old.onMessage.fire({
    id,
    type: "result",
    result: summary,
    meta: { kind: "summary" },
  });
  assert.equal(h.$(".result").hidden, true);
  assert.match(h.$(".status").textContent, /取消/);
});
test("QA queued error from cancelled task cannot disconnect a new task on the same video", async () => {
  const h = await panel();
  await h.click(".start");
  const old = h.ports[0],
    id = old.sent[0].id;
  h.$(".cancel").click();
  await h.click(".start");
  const active = h.ports[1];
  old.onMessage.fire({ id, type: "error", error: "旧请求失败" });
  assert.equal(
    active.disconnected,
    false,
    "old connection must not stop the new active request",
  );
  assert.equal(h.$(".cancel").hidden, false);
  assert.equal(h.$(".error").hidden, true);
  h.reply(summary, "summary");
  assert.equal(h.$(".result").hidden, false);
});
test("QA same-BV CID change discards queued result belonging to the previous part", async () => {
  const h = await panel();
  h.window.dispatchEvent(
    new h.window.CustomEvent("bili-codex-data", {
      detail: JSON.stringify({ player: { bvid: "BV1ph4y1c7kp", cid: "11" } }),
    }),
  );
  h.advance(1200);
  await h.click(".start");
  const old = h.ports[0],
    id = old.sent[0].id;
  h.window.dispatchEvent(
    new h.window.CustomEvent("bili-codex-data", {
      detail: JSON.stringify({ player: { bvid: "BV1ph4y1c7kp", cid: "22" } }),
    }),
  );
  h.advance(1200);
  assert.equal(old.disconnected, true);
  old.onMessage.fire({
    id,
    type: "result",
    result: summary,
    meta: { kind: "summary" },
  });
  assert.equal(
    h.$(".result").hidden,
    true,
    "a different part is a different video input",
  );
});
test("QA disable/re-enable does not let an old connection complete the replacement task", async () => {
  const h = await panel();
  await h.click(".start");
  const old = h.ports[0],
    id = old.sent[0].id;
  h.context.BiliFeatures.context.patch("ai.enabled", false);
  await flush();
  h.context.BiliFeatures.context.patch("ai.enabled", true);
  await flush();
  await h.click(".start");
  const active = h.ports[1];
  old.onMessage.fire({
    id,
    type: "result",
    result: summary,
    meta: { kind: "summary" },
  });
  assert.equal(active.disconnected, false);
  assert.equal(h.$(".result").hidden, true);
  assert.equal(h.$(".cancel").hidden, false);
  h.reply(summary, "summary");
  assert.equal(h.$(".result").hidden, false);
});

function background({ ai = {}, official = true, hold = false } = {}) {
  const storage = { biliSettings: { ai: { enabled: true, ...ai } } },
    native = [],
    fetches = [];
  const snapshot = {
    bvid: "BV1ph4y1c7kp",
    aid: "616563515",
    cid: "1213740777",
    title: "测试视频",
    duration: 120,
    tracks: official
      ? [
          { lan: "en", subtitle_url: "https://aisubtitle.hdslb.com/en.json" },
          {
            lan: "zh-CN",
            subtitle_url: "https://aisubtitle.hdslb.com/zh.json",
          },
        ]
      : [],
  };
  const values = {
    summary,
    chat: { answer: "答复", references: [{ start: 4, label: "依据" }] },
    ads: {
      segments: [
        {
          start: 10,
          end: 20,
          label: "广告",
          reason: "购买引导",
          confidence: 0.95,
        },
      ],
    },
    polish: { article: "整理文章" },
  };
  const chrome = {
    runtime: {
      id: "test",
      getURL: (p) => "chrome-extension://test/" + p,
      onConnect: event(),
      onMessage: event(),
      connectNative: () => {
        const p = {
          onMessage: event(),
          onDisconnect: event(),
          sent: null,
          disconnected: false,
          disconnect() {
            p.disconnected = true;
          },
          postMessage(m) {
            p.sent = m;
            if (hold) return;
            queueMicrotask(() => {
              const kind = m.type === "summarize" ? "summary" : m.type,
                result =
                  kind === "transcribe"
                    ? {
                        bvid: m.input.bvid,
                        cid: m.input.cid,
                        title: m.input.title,
                        duration: m.input.duration,
                        subtitles: [{ start: 0, end: 5, text: "本机识别" }],
                        source: "local-asr",
                        language: m.input.language,
                      }
                    : values[kind];
              p.onMessage.fire({
                id: m.id,
                type: "result",
                result,
                meta: { kind, generatedAt: "2026-10-28" },
              });
            });
          },
        };
        native.push(p);
        return p;
      },
    },
    storage: {
      local: {
        get: async (key) =>
          key === null ? { ...storage } : { [key]: storage[key] },
        set: async (values) => Object.assign(storage, values),
        remove: async (keys) => {
          for (const key of Array.isArray(keys) ? keys : [keys])
            delete storage[key];
        },
      },
    },
  };
  const context = vm.createContext({
    chrome,
    crypto: crypto.webcrypto,
    URL,
    Response,
    TextEncoder,
    TextDecoder,
    AbortController,
    AbortSignal,
    setTimeout,
    clearTimeout,
    console,
    fetch: async (url, options) => {
      fetches.push({ url: String(url), credentials: options.credentials });
      const u = new URL(url);
      if (u.hostname.endsWith(".hdslb.com"))
        return new Response(
          JSON.stringify({
            body: [
              {
                from: 0,
                to: 5,
                content: u.pathname.includes("zh") ? "中文字幕" : "English",
              },
            ],
          }),
        );
      if (u.pathname.endsWith("/nav"))
        return new Response(
          JSON.stringify({
            data: {
              wbi_img: {
                img_url:
                  "https://i0.hdslb.com/7cd084941338484aae1ad9425b84077c.png",
                sub_url:
                  "https://i0.hdslb.com/4932caff0ff746eab6f01bf08b70ac45.png",
              },
            },
          }),
        );
      if (u.pathname.includes("/subtitle/web/view"))
        return new Response("", { status: 404 });
      if (u.pathname.includes("/player/wbi/v2"))
        return new Response(
          JSON.stringify({ code: 0, data: { subtitle: { subtitles: [] } } }),
        );
      if (u.pathname.includes("/playurl"))
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              dash: {
                audio: [
                  {
                    bandwidth: 100,
                    baseUrl: "https://audio.bilivideo.com/test.m4a",
                  },
                ],
              },
            },
          }),
        );
      throw Error("Unexpected mocked endpoint: " + u.pathname);
    },
  });
  context.importScripts = (...files) =>
    files.forEach((file) =>
      vm.runInContext(
        fs.readFileSync(path.join(root, "extension", file), "utf8"),
        context,
        { filename: file },
      ),
    );
  vm.runInContext(
    fs.readFileSync(path.join(root, "extension/background.js"), "utf8"),
    context,
    { filename: "background.js" },
  );
  let id = 0;
  function connect() {
    const messages = [],
      port = {
        name: "bili-codex-panel",
        sender: {
          id: "test",
          url: "https://www.bilibili.com/video/BV1ph4y1c7kp/",
          frameId: 0,
        },
        onMessage: event(),
        onDisconnect: event(),
        postMessage: (m) => messages.push(m),
        disconnect() {
          port.disconnected = true;
        },
      };
    chrome.runtime.onConnect.fire(port);
    return { port, messages };
  }
  async function request(type, extra = {}) {
    const { port, messages } = connect();
    await Promise.all(
      port.onMessage.fire({ type, id: "qa-" + ++id, snapshot, ...extra }),
    );
    return {
      port,
      messages,
      result: messages.find((m) => m.type === "result"),
      error: messages.find((m) => m.type === "error"),
    };
  }
  return {
    context,
    chrome,
    storage,
    native,
    fetches,
    snapshot,
    connect,
    request,
  };
}
test("QA background prefers Chinese official subtitles and subtitles-only requests never invoke the model", async () => {
  const h = background();
  const r = await h.request("subtitles");
  assert(!r.error);
  assert.equal(r.result.result.source, "official");
  assert.equal(r.result.result.subtitles[0].text, "中文字幕");
  assert.equal(h.native.length, 0);
  assert(
    h.fetches.some(
      (f) => f.url.endsWith("zh.json") && f.credentials === "omit",
    ),
  );
  assert(!h.fetches.some((f) => f.url.endsWith("en.json")));
});
test("QA no-caption fallback requests a permitted audio URL and forwards the selected language to ASR", async () => {
  const h = background({
    official: false,
    ai: { asrFallback: true, asrLanguage: "en" },
  });
  const r = await h.request("subtitles");
  assert(!r.error);
  assert.equal(h.native.length, 1);
  assert.equal(h.native[0].sent.type, "transcribe");
  assert.equal(h.native[0].sent.input.language, "en");
  assert.equal(
    h.native[0].sent.input.audioUrl,
    "https://audio.bilivideo.com/test.m4a",
  );
  assert.equal(r.result.result.source, "local-asr");
});
test("QA disabled ASR fallback gives an explicit error without invoking native transcription", async () => {
  const h = background({ official: false, ai: { asrFallback: false } });
  const r = await h.request("subtitles");
  assert.match(r.error.error, /开启本机转写/);
  assert.equal(h.native.length, 0);
});
for (const mode of ["cache", "smart", "always"])
  test(`QA ad ${mode} mode has the documented native-call and cache behavior`, async () => {
    const h = background({ ai: { adDetectionMode: mode } });
    const first = await h.request("ads");
    assert(!first.error);
    if (mode === "cache") {
      assert.equal(first.result.result.cacheMiss, true);
      assert.equal(h.native.length, 0);
      await h.request("ads", { force: true });
      assert.equal(h.native.length, 0);
    } else {
      assert.equal(h.native.length, 1);
      const second = await h.request("ads");
      assert(!second.error);
      assert.equal(h.native.length, mode === "always" ? 2 : 1);
      if (mode === "smart") assert.equal(second.result.meta.cached, true);
    }
  });
test("QA summary-style and chat-question changes cannot reuse an incompatible AI cache", async () => {
  const h = background();
  await h.request("summarize");
  await h.request("summarize");
  assert.equal(h.native.length, 1);
  h.storage.biliSettings.ai.summaryPrompt = "按步骤总结";
  await h.request("summarize");
  assert.equal(h.native.length, 2);
  await h.request("chat", { question: "甲问题", history: [] });
  await h.request("chat", { question: "甲问题", history: [] });
  assert.equal(h.native.length, 3);
  await h.request("chat", { question: "乙问题", history: [] });
  assert.equal(h.native.length, 4);
});
test("QA background cancellation disconnects the native port and does not save a result", async () => {
  const h = background({ hold: true }),
    { port, messages } = h.connect();
  const pending = Promise.all(
    port.onMessage.fire({
      type: "summarize",
      id: "pending",
      snapshot: h.snapshot,
    }),
  );
  for (let i = 0; i < 10 && !h.native.length; i++) await flush();
  assert.equal(h.native.length, 1);
  await Promise.all(port.onMessage.fire({ type: "cancel" }));
  await pending;
  assert.equal(h.native[0].disconnected, true);
  assert(!messages.some((m) => m.type === "result"));
  assert(!Object.keys(h.storage).some((k) => k.startsWith("ai:")));
});
test("QA saved-seconds statistics serialize concurrent skip reports and reject foreign pages", async () => {
  const h = background();
  const sender = {
    id: "test",
    url: "https://www.bilibili.com/video/BV1ph4y1c7kp/",
    frameId: 0,
  };
  h.chrome.runtime.onMessage.fire(
    { type: "saved-seconds", seconds: 9 },
    sender,
    () => {},
  );
  h.chrome.runtime.onMessage.fire(
    { type: "saved-seconds", seconds: 4.5 },
    sender,
    () => {},
  );
  for (let i = 0; i < 8; i++) await flush();
  assert.equal(h.storage.biliStats.skippedSeconds, 13.5);
  assert.equal(h.storage.biliStats.skippedSegments, 2);
  h.chrome.runtime.onMessage.fire(
    { type: "saved-seconds", seconds: 10 },
    { ...sender, url: "https://evil.example/" },
    () => {},
  );
  for (let i = 0; i < 4; i++) await flush();
  assert.equal(h.storage.biliStats.skippedSeconds, 13.5);
  assert.equal(h.storage.biliStats.skippedSegments, 2);
});
