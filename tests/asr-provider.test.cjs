"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  crypto = require("node:crypto"),
  { PassThrough } = require("node:stream");
const root = path.resolve(
  process.env.BILI_TEST_SOURCE_ROOT || path.join(__dirname, ".."),
);
const C = require(path.join(root, "extension/common/config.js")),
  runner = require(path.join(root, "native/runner.cjs")),
  tasks = require(path.join(root, "native/tasks.cjs")),
  localSummary = require(path.join(root, "native/local-summary.cjs"));
const video = {
  bvid: "BV1ph4y1c7kp",
  aid: "616563515",
  cid: "1213740777",
  duration: 70,
  title: "合成字幕来源测试",
};
const tracks = [
  {
    lan: "zh-CN",
    subtitle_url: "https://aisubtitle.hdslb.com/asr-provider.json",
  },
];
const summary = {
  summary: "根据给定文字总结",
  keyPoints: ["合成内容"],
  segments: [{ start: 0, end: 3, title: "开头", summary: "根据字幕" }],
};
function event() {
  return { addListener() {} };
}
function harness() {
  const calls = { asr: [], local: [], codex: [], native: [], requests: [] },
    storage = {},
    hostModule = { exports: {} };
  function hostRequire(name) {
    if (name === "node:fs") return { ...fs, writeFileSync() {} };
    if (name === "node:path") return path;
    if (name === "./runner.cjs")
      return {
        ...runner,
        runCodex: async (input) => {
          calls.codex.push(input);
          return { result: summary };
        },
      };
    if (name === "./tasks.cjs") return tasks;
    if (name === "./local-summary.cjs") return localSummary;
    if (name === "./local-model.cjs")
      return {
        DEFAULT_MODEL: "qwen3:4b",
        runLocal: async (options) => {
          calls.local.push(options.input);
          if (
            options.schema?.properties?.segments?.items?.required?.includes(
              "startIndex",
            )
          )
            return {
              ...summary,
              segments: summary.segments.map(({ title, summary: text }) => ({
                startIndex: 0,
                title,
                summary: text,
              })),
            };
          return summary;
        },
      };
    if (name === "./asr.cjs")
      return {
        transcribe: async (input) => {
          calls.asr.push(input);
          return {
            ...video,
            subtitles: [{ start: 0, end: 3, text: "本机Whisper转写文字" }],
            language: input.language || "zh",
            source: "local-asr",
          };
        },
      };
    throw Error("Unexpected host dependency: " + name);
  }
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
    },
  );
  async function receive(message) {
    const input = new PassThrough(),
      output = new PassThrough(),
      replies = [];
    output.on("data", (buffer) =>
      replies.push(JSON.parse(buffer.subarray(4).toString("utf8"))),
    );
    const host = hostModule.exports.start(input, output, {});
    await host.receive({ id: "asr-provider-test", ...message });
    input.end();
    const result = replies.find((reply) => reply.type === "result");
    assert(result, JSON.stringify(replies));
    return result;
  }
  const chrome = {
    runtime: {
      id: "test",
      onConnect: event(),
      onMessage: event(),
    },
    storage: {
      local: {
        get: async (key) =>
          key === null ? { ...storage } : { [key]: storage[key] },
        set: async (values) => Object.assign(storage, values),
        remove: async (keys) => keys.forEach((key) => delete storage[key]),
      },
    },
  };
  const context = vm.createContext({
    chrome,
    URL,
    TextEncoder,
    TextDecoder,
    AbortController,
    crypto: crypto.webcrypto,
    setTimeout,
    clearTimeout,
    fetch: async (raw, options) => {
      const url = new URL(raw);
      assert.equal(
        options?.body,
        undefined,
        "caption reads must not upload audio",
      );
      assert(
        options?.method === undefined || options.method === "GET",
        "caption and playback metadata only use GET",
      );
      calls.requests.push(url);
      if (url.hostname === "aisubtitle.hdslb.com")
        return Response.json({
          body: [{ from: 0, to: 3, content: "B站已有字幕文字" }],
        });
      assert.equal(url.hostname, "api.bilibili.com");
      if (url.pathname.endsWith("/nav"))
        return Response.json({
          data: {
            wbi_img: {
              img_url:
                "https://i0.hdslb.com/7cd084941338484aae1ad9425b84077c.png",
              sub_url:
                "https://i0.hdslb.com/4932caff0ff746eab6f01bf08b70ac45.png",
            },
          },
        });
      if (url.pathname.includes("/subtitle/web/view"))
        return new Response("", { status: 404 });
      if (url.pathname === "/x/player/wbi/v2")
        return Response.json({
          code: 0,
          data: { subtitle: { subtitles: [] } },
        });
      if (url.pathname.endsWith("/playurl"))
        return Response.json({
          code: 0,
          data: {
            dash: {
              audio: [{ baseUrl: "https://audio.bilivideo.com/test.m4a" }],
            },
          },
        });
      throw Error("Unexpected subtitle URL: " + url.href);
    },
  });
  context.importScripts = (...files) =>
    files.forEach((file) =>
      vm.runInContext(
        fs.readFileSync(path.join(root, "extension", file), "utf8"),
        context,
      ),
    );
  vm.runInContext(
    fs.readFileSync(path.join(root, "extension/background.js"), "utf8"),
    context,
  );
  context.nativeRequest = async (type, input, options) => {
    calls.native.push({ type, input, options });
    return receive({ type, input, provider: options.provider });
  };
  return {
    calls,
    storage,
    receive,
    load: (
      provider,
      official = false,
      language = "auto",
      { force = false, asrFallback = true } = {},
    ) =>
      context.loadSubtitles(
        { ...video, tracks: official ? tracks : [] },
        "https://www.bilibili.com/video/" + video.bvid + "/",
        undefined,
        C.normalize({
          ai: { provider, asrFallback, asrLanguage: language },
        }),
        undefined,
        force,
      ),
  };
}

for (const provider of ["local", "codex"]) {
  for (const official of [true, false]) {
    test(`${provider} text summary uses ${official ? "existing captions without recognition" : "local ASR before text analysis"}`, async () => {
      const h = harness(),
        input = await h.load(provider, official);
      assert.equal(input.source, official ? "official" : "local-asr");
      assert.equal(h.calls.asr.length, official ? 0 : 1);
      assert.equal(h.calls.local.length, 0);
      assert.equal(h.calls.codex.length, 0);
      assert.equal(h.calls.native.length, official ? 0 : 1);
      if (!official) {
        assert.equal(h.calls.native[0].type, "transcribe");
        assert.equal(h.calls.native[0].options.provider, undefined);
      }
      const result = await h.receive({
        type: "summarize",
        provider,
        model: "qwen3:4b",
        input,
      });
      assert.equal(result.meta.provider, provider);
      assert.equal(h.calls.local.length, provider === "local" ? 2 : 0);
      assert.equal(h.calls.codex.length, provider === "codex" ? 1 : 0);
      assert.equal(result.result.segments[0].start, input.subtitles[0].start);
      assert.equal(
        result.result.segments[0].end,
        provider === "local" ? input.duration : summary.segments[0].end,
      );
      const textInput = h.calls[provider][0];
      assert.equal(textInput.audioUrl, undefined);
      assert(textInput.subtitles[0].text);
    });
  }
  test(`native transcribe request explicitly tagged ${provider} still dispatches to local ASR only`, async () => {
    const h = harness(),
      result = await h.receive({
        type: "transcribe",
        provider,
        input: { ...video, audioUrl: "https://audio.bilivideo.com/test.m4a" },
      });
    assert.equal(h.calls.asr.length, 1);
    assert.equal(h.calls.local.length, 0);
    assert.equal(h.calls.codex.length, 0);
    assert.equal(result.meta.provider, "local-asr");
  });
}

test("ASR cache survives text-provider changes, language changes regenerate it, and observed official captions replace it", async () => {
  const h = harness();
  await h.load("local");
  const requestCount = h.calls.requests.length;
  const cached = await h.load("codex");
  assert.equal(cached.source, "local-asr");
  assert.equal(h.calls.requests.length, requestCount);
  assert.equal(h.calls.asr.length, 1);
  await h.load("codex", false, "en");
  assert.equal(h.calls.asr.length, 2);
  const replaced = await h.load("codex", true, "en");
  assert.equal(replaced.source, "official");
  assert.equal(h.calls.asr.length, 2);
  assert.equal(h.calls.local.length, 0);
  assert.equal(h.calls.codex.length, 0);
});

test("force reread with online text provider regenerates local ASR without routing audio to text services", async () => {
  const h = harness();
  await h.load("local");
  await h.load("codex", false, "auto", { force: true });
  assert.equal(h.calls.asr.length, 2);
  assert.equal(h.calls.native.length, 2);
  assert(h.calls.native.every((call) => call.type === "transcribe"));
  assert(h.calls.native.every((call) => call.options.provider === undefined));
  assert.equal(h.calls.local.length, 0);
  assert.equal(h.calls.codex.length, 0);
});

test("disabled local ASR never falls back to an online text service when captions are missing", async () => {
  const h = harness();
  await assert.rejects(
    h.load("codex", false, "auto", { asrFallback: false }),
    /开启本机转写/,
  );
  assert.equal(h.calls.native.length, 0);
  assert.equal(h.calls.asr.length, 0);
  assert.equal(h.calls.local.length, 0);
  assert.equal(h.calls.codex.length, 0);
  assert.equal(Object.keys(h.storage).length, 0);
});
