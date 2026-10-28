"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  crypto = require("node:crypto");
const { PassThrough } = require("node:stream");
const root = path.resolve(
  process.env.BILI_TEST_SOURCE_ROOT || path.join(__dirname, ".."),
);
const C = require("../extension/common/config.js"),
  actualLocal = require("../native/local-model.cjs"),
  actualRunner = require("../native/runner.cjs"),
  tasks = require("../native/tasks.cjs");
const flush = () => new Promise(setImmediate);
function event() {
  const callbacks = [];
  return {
    addListener: (fn) => callbacks.push(fn),
    fire: (...args) => callbacks.map((fn) => fn(...args)),
  };
}
const summary = {
  summary: "本地模拟总结",
  keyPoints: ["当前字幕重点"],
  segments: [{ start: 0, end: 5, title: "第一段", summary: "根据当前字幕" }],
};
function harness({
  ai = {},
  missingBridge = false,
  modelReady = true,
  holdPull = false,
  ollamaMetrics = {},
} = {}) {
  const storage = { biliSettings: C.normalize({ ai }) },
    native = [],
    diagnostics = [],
    localCalls = [],
    codexCalls = [],
    ollamaCalls = [];
  const state = { modelReady, pullController: null, pullCancelled: false };
  const id = "qaextension",
    getURL = (p) => "chrome-extension://" + id + "/" + p;
  const snapshot = {
    bvid: "BV1ph4y1c7kp",
    aid: "616563515",
    cid: "1213740777",
    title: "当前合成视频",
    duration: 60,
    tracks: [
      { lan: "zh-CN", subtitle_url: "https://aisubtitle.hdslb.com/qa.json" },
    ],
  };
  const ollamaDeps = {
    findRuntime: () => path.resolve(root, "native/ollama-not-executed.exe"),
    fetch: async (url, options) => {
      ollamaCalls.push({ url, options });
      if (url.endsWith("/api/version"))
        return Response.json({ version: "0.34.0" });
      if (url.endsWith("/api/tags"))
        return Response.json({
          models: state.modelReady
            ? actualLocal.MODELS.map((name) => ({ name }))
            : [],
        });
      if (url.endsWith("/api/pull"))
        return new Response(
          new ReadableStream({
            start(controller) {
              state.pullController = controller;
              controller.enqueue(
                Buffer.from(
                  '{"status":"pulling synthetic layer","completed":25,"total":100}\n',
                ),
              );
              if (!holdPull) {
                state.modelReady = true;
                controller.enqueue(Buffer.from('{"status":"success"}\n'));
                controller.close();
              }
            },
            cancel() {
              state.pullCancelled = true;
            },
          }),
        );
      if (url.endsWith("/api/chat"))
        return Response.json({
          done: true,
          done_reason: "stop",
          message: { content: JSON.stringify(summary) },
          ...ollamaMetrics,
        });
      throw Error("Unexpected local mock URL");
    },
  };
  const local = {
    ...actualLocal,
    status: (options) => (
      localCalls.push({ type: "status", options }),
      actualLocal.status(options, ollamaDeps)
    ),
    prepare: (options) => (
      localCalls.push({ type: "prepare", options }),
      actualLocal.prepare(options, ollamaDeps)
    ),
    runLocal: (options) => (
      localCalls.push({ type: "runLocal", options }),
      actualLocal.runLocal(options, ollamaDeps)
    ),
  };
  const hostModule = { exports: {} },
    hostRequire = (name) => {
      if (name === "node:fs")
        return {
          ...fs,
          writeFileSync: (file, text) =>
            diagnostics.push({ file, value: JSON.parse(text) }),
        };
      if (name === "node:path") return path;
      if (name === "./runner.cjs")
        return {
          ...actualRunner,
          runCodex: async (input, options) => (
            codexCalls.push({ input, options }),
            {
              result: { ...summary, summary: "显式 Codex 模拟总结" },
              usage: { input_tokens: 1, output_tokens: 1 },
            }
          ),
        };
      if (name === "./local-model.cjs") return local;
      if (name === "./tasks.cjs") return tasks;
      if (name === "./asr.cjs")
        return {
          available: () => true,
          transcribe: async () => {
            throw Error("ASR is outside this integration seam");
          },
        };
      throw Error("Unexpected host dependency " + name);
    };
  vm.runInNewContext(
    fs.readFileSync(path.join(root, "native/host.cjs"), "utf8"),
    {
      require: hostRequire,
      module: hostModule,
      exports: hostModule.exports,
      __dirname: path.join(root, "native"),
      Buffer,
      process,
      AbortController,
      console,
      setTimeout,
      clearTimeout,
    },
    { filename: "native/host.cjs" },
  );
  const chrome = {
    runtime: {
      id,
      getURL,
      onConnect: event(),
      onMessage: event(),
      connectNative: () => {
        const p = {
          onMessage: event(),
          onDisconnect: event(),
          sent: [],
          disconnected: false,
        };
        native.push(p);
        if (missingBridge) {
          p.postMessage = (m) => p.sent.push(m);
          p.disconnect = () => {
            p.disconnected = true;
          };
          queueMicrotask(() => {
            chrome.runtime.lastError = {
              message: "Specified native messaging host not found.",
            };
            p.onDisconnect.fire();
            delete chrome.runtime.lastError;
          });
          return p;
        }
        const input = new PassThrough(),
          output = new PassThrough();
        let buffered = Buffer.alloc(0);
        hostModule.exports.start(input, output, {
          codexPath: process.execPath,
          extensionOrigin: getURL(""),
        });
        output.on("data", (chunk) => {
          buffered = Buffer.concat([buffered, chunk]);
          while (buffered.length >= 4) {
            const n = buffered.readUInt32LE(0);
            if (buffered.length < n + 4) return;
            const message = JSON.parse(buffered.subarray(4, n + 4));
            buffered = buffered.subarray(n + 4);
            if (!p.disconnected) p.onMessage.fire(message);
          }
        });
        p.postMessage = (m) => {
          p.sent.push(m);
          input.write(hostModule.exports.encode(m));
        };
        p.disconnect = () => {
          if (!p.disconnected) {
            p.disconnected = true;
            input.end();
          }
        };
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
    URL,
    Response,
    TextEncoder,
    TextDecoder,
    AbortController,
    AbortSignal,
    crypto: crypto.webcrypto,
    setTimeout,
    clearTimeout,
    console,
    fetch: async (url) => {
      assert(String(url).startsWith("https://aisubtitle.hdslb.com/"));
      return Response.json({
        body: [{ from: 0, to: 5, content: "当前视频的合成中文字幕" }],
      });
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
  let requestId = 0;
  function connect(
    name = "bili-codex-panel",
    sender = {
      id,
      url: "https://www.bilibili.com/video/BV1ph4y1c7kp/",
      frameId: 0,
    },
  ) {
    const messages = [],
      p = {
        name,
        sender,
        onMessage: event(),
        onDisconnect: event(),
        postMessage: (m) => messages.push(m),
        disconnect() {
          p.disconnected = true;
        },
      };
    chrome.runtime.onConnect.fire(p);
    return { port: p, messages };
  }
  async function request(type = "summarize", extra = {}) {
    const { port, messages } = connect();
    await Promise.all(
      port.onMessage.fire({
        type,
        id: "qa-model-" + ++requestId,
        snapshot,
        ...extra,
      }),
    );
    return {
      port,
      messages,
      result: messages.find((m) => m.type === "result"),
      error: messages.find((m) => m.type === "error"),
    };
  }
  async function check(
    url = getURL("options.html#ai"),
    extra = {},
    senderExtra = {},
  ) {
    let response;
    const values = chrome.runtime.onMessage.fire(
      { type: "check", ...extra },
      { id, url, frameId: 0, ...senderExtra },
      (m) => (response = m),
    );
    for (let n = 0; n < 30 && !response && values.some(Boolean); n++)
      await flush();
    return { response, accepted: values.some(Boolean) };
  }
  const setup = (url = getURL("options.html#ai"), senderExtra = {}) =>
    connect("bili-model-setup", { id, url, frameId: 0, ...senderExtra });
  return {
    storage,
    native,
    localCalls,
    codexCalls,
    ollamaCalls,
    diagnostics,
    state,
    context,
    chrome,
    id,
    getURL,
    snapshot,
    connect,
    request,
    check,
    setup,
  };
}
test("settings default local/qwen3:4b traverses background framing into actual host/local helper and validated result", async () => {
  const h = harness(),
    r = await h.request();
  assert(!r.error);
  assert.equal(r.result.result.summary, summary.summary);
  assert.equal(r.result.meta.provider, "local");
  assert.equal(r.result.meta.model, "qwen3:4b");
  assert.equal(h.native[0].sent[0].provider, "local");
  assert.equal(h.native[0].sent[0].model, "qwen3:4b");
  assert.equal(
    h.localCalls.find((c) => c.type === "runLocal").options.input.subtitles[0]
      .text,
    "当前视频的合成中文字幕",
  );
  assert.equal(h.codexCalls.length, 0);
  assert(h.ollamaCalls.some((c) => c.url.endsWith("/api/chat")));
});
test("explicit codex selection traverses background/host without invoking local generation", async () => {
  const h = harness({ ai: { provider: "codex" } }),
    r = await h.request();
  assert(!r.error);
  assert.equal(r.result.meta.provider, "codex");
  assert.equal(r.result.result.summary, "显式 Codex 模拟总结");
  assert.equal(h.native[0].sent[0].provider, "codex");
  assert.equal(h.codexCalls.length, 1);
  assert.equal(h.localCalls.filter((c) => c.type === "runLocal").length, 0);
});
test("safe local timing metrics cross actual helper/host/framing into progress and result metadata", async () => {
  const h = harness({
    ollamaMetrics: {
      load_duration: 40610000000,
      prompt_eval_duration: 36918000000,
      eval_duration: 7748000000,
      total_duration: 87658000000,
      prompt_eval_count: 474,
      eval_count: 381,
      secret: "do not forward",
    },
  });
  const r = await h.request();
  assert(!r.error);
  const expected = {
    loadMs: 40610,
    promptMs: 36918,
    generateMs: 7748,
    totalMs: 87658,
    promptTokens: 474,
    outputTokens: 381,
  };
  assert.deepEqual(r.result.meta.localMetrics, expected);
  const progress = r.messages.find((m) => m.stage === "local-complete");
  assert(progress);
  assert.deepEqual(progress.metrics, expected);
  assert.equal(progress.id, r.result.id);
  assert.equal(r.result.result.summary, summary.summary);
});
test("AI caches cannot cross provider or local model selections", async () => {
  const h = harness();
  await h.request();
  const hit = await h.request();
  assert.equal(hit.result.meta.cached, true);
  assert.equal(h.native.length, 1);
  h.storage.biliSettings = C.normalize({ ai: { provider: "codex" } });
  const codex = await h.request();
  assert.equal(codex.result.meta.provider, "codex");
  assert.equal(h.native.length, 2);
  h.storage.biliSettings = C.normalize({
    ai: { provider: "local", localModel: "qwen3:1.7b" },
  });
  const small = await h.request();
  assert.equal(small.result.meta.model, "qwen3:1.7b");
  assert.equal(h.native.length, 3);
  h.storage.biliSettings = C.normalize({
    ai: { provider: "local", localModel: "qwen3:4b" },
  });
  const restored = await h.request();
  assert.equal(restored.result.meta.model, "qwen3:4b");
  assert.equal(restored.result.meta.cached, undefined);
  assert.equal(h.native.length, 4);
});
for (const hash of ["#ai", "#backup"])
  test(`own options page ${hash} can check the chosen provider/model and prepare it`, async () => {
    const h = harness(),
      url = h.getURL("options.html" + hash),
      check = await h.check(url, { model: "qwen3:1.7b" });
    assert.equal(check.accepted, true);
    assert.equal(check.response.ok, true);
    assert.equal(check.response.provider, "local");
    assert.equal(check.response.localRuntimeReady, true);
    assert.equal(check.response.localModelReady, true);
    assert.equal(check.response.localModel, "qwen3:1.7b");
    assert.equal(check.response.codexInstalled, true);
    const setup = h.setup(url);
    await Promise.all(
      setup.port.onMessage.fire({
        type: "setup-local-model",
        id: "setup",
        model: "qwen3:1.7b",
      }),
    );
    const result = setup.messages.find((m) => m.type === "result");
    assert(result);
    assert.equal(result.id, "setup");
    assert.equal(result.result.ready, true);
    assert.equal(result.result.model, "qwen3:1.7b");
    assert(
      h.localCalls.some(
        (c) => c.type === "prepare" && c.options.model === "qwen3:1.7b",
      ),
    );
  });
test("foreign pages, forged extension URLs and extension subframes cannot check or prepare models", async () => {
  const h = harness();
  const targets = [
    { url: "https://evil.example/options.html", extra: {} },
    { url: "https://www.bilibili.com/video/BV1ph4y1c7kp/", extra: {} },
    { url: "chrome-extension://other/options.html#ai", extra: {} },
    { url: h.getURL("options.html#ai"), extra: { frameId: 1 } },
    { url: h.getURL("options.html#backup"), extra: { id: "other" } },
  ];
  for (const { url, extra } of targets) {
    const checked = await h.check(url, {}, extra);
    assert.equal(checked.accepted, false, "unauthorized status check " + url);
    const setup = h.setup(url, extra);
    assert.equal(setup.port.disconnected, true, "unauthorized setup " + url);
    await Promise.all(
      setup.port.onMessage.fire({
        type: "setup-local-model",
        id: "bad",
        model: "qwen3:4b",
      }),
    );
  }
  assert.equal(h.native.length, 0);
  assert.equal(h.ollamaCalls.length, 0);
});
test("own extension popup without sender.tab/frameId remains compatible with Chrome MessageSender", async () => {
  const h = harness(),
    url = h.getURL("popup.html");
  const checked = await h.check(url, {}, { frameId: undefined });
  assert.equal(checked.accepted, true);
  assert.equal(checked.response.ok, true);
  assert.equal(checked.response.localModelReady, true);
  const setup = h.setup(url, { frameId: undefined });
  await Promise.all(
    setup.port.onMessage.fire({
      type: "setup-local-model",
      id: "popup",
      model: "qwen3:4b",
    }),
  );
  assert.equal(setup.port.disconnected, undefined);
  assert(setup.messages.some((m) => m.type === "result" && m.result.ready));
});
test("illegal/cloud models and unsupported providers fail before reaching the native host", async () => {
  for (const model of [
    "qwen3:4b:cloud",
    "qwen3:cloud",
    "https://remote.example/model",
    "qwen3:4b;whoami",
  ]) {
    const h = harness(),
      checked = await h.check(h.getURL("options.html#ai"), { model });
    assert.equal(checked.response.ok, false);
    assert.match(checked.response.error, /模型无效/);
    const s = h.setup();
    await Promise.all(
      s.port.onMessage.fire({ type: "setup-local-model", id: "bad", model }),
    );
    assert(s.messages.some((m) => m.type === "error"));
    assert.equal(h.native.length, 0);
  }
  const h = harness(),
    checked = await h.check(h.getURL("options.html#ai"), {
      provider: "remote",
    });
  assert.equal(checked.response.ok, false);
  assert.equal(h.native.length, 0);
});
test("setup progress crosses helper, host framing and background with the original UI request ID", async () => {
  const h = harness({ modelReady: false }),
    s = h.setup();
  await Promise.all(
    s.port.onMessage.fire({
      type: "setup-local-model",
      id: "ui-request",
      model: "qwen3:4b",
    }),
  );
  const progress = s.messages.find((m) => m.completed === 25);
  assert(progress);
  assert.equal(progress.type, "progress");
  assert.equal(progress.id, "ui-request");
  assert.equal(progress.stage, "local-model-download");
  assert.equal(progress.percent, 25);
  assert.equal(s.messages.at(-1).type, "result");
  assert.equal(s.messages.at(-1).result.ready, true);
  assert.equal(h.state.modelReady, true);
});
for (const mode of ["cancel", "disconnect"])
  test(`setup ${mode} aborts the same pull operation and suppresses a success result`, async () => {
    const h = harness({ modelReady: false, holdPull: true }),
      s = h.setup();
    const pending = Promise.all(
      s.port.onMessage.fire({
        type: "setup-local-model",
        id: "prepare-active",
        model: "qwen3:4b",
      }),
    );
    for (let n = 0; n < 30 && !h.state.pullController; n++) await flush();
    assert(h.state.pullController);
    assert(s.messages.some((m) => m.completed === 25));
    if (mode === "cancel")
      await Promise.all(
        s.port.onMessage.fire({ type: "cancel", id: "prepare-active" }),
      );
    else s.port.onDisconnect.fire();
    await pending;
    for (let n = 0; n < 5; n++) await flush();
    assert.equal(h.native[0].disconnected, true);
    assert.equal(h.state.pullCancelled, true);
    assert(!s.messages.some((m) => m.type === "result"));
    assert.equal(h.state.modelReady, false);
  });
test("missing native bridge returns an install instruction instead of reporting the local model ready", async () => {
  const h = harness({ missingBridge: true }),
    checked = await h.check();
  assert.equal(checked.response.ok, false);
  assert.match(checked.response.error, /尚未安装本机桥接.*安装本机桥接/);
  const s = h.setup();
  await Promise.all(
    s.port.onMessage.fire({
      type: "setup-local-model",
      id: "setup",
      model: "qwen3:4b",
    }),
  );
  assert(
    s.messages.some((m) => m.type === "error" && /安装本机桥接/.test(m.error)),
  );
  assert(!s.messages.some((m) => m.type === "result"));
});
