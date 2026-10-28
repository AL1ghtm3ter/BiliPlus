"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  crypto = require("node:crypto");
const root = path.resolve(
    process.env.BILI_TEST_SOURCE_ROOT || path.join(__dirname, ".."),
  ),
  S = require(path.join(root, "extension/subtitles.js"));
const encoded =
  "//subtitle.bilibili.com/%01%1B%5C=_%04%12%12%049f%2F%07H%08%29~%16$5%0D.%0B%0AL%03%2C%01%1A%00M:%1Ce%00%0F%1FF%03%003%1A6%17%0A%25U%14%16Q%16%2CI%16o%11G%5E%08GnDJPT%5CV%19DqWi%5CG%1B%7C%06Z%08ZV%0FUXzLHu%16%1EDGT=%10%11w%15%14%0D%09%14%3FF%18U?auth_key=test";
const expected =
  "https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/616563515121374077786d3d34f9199697f792c6c72be4eb7c0?auth_key=test";
function integer(value) {
  const bytes = [];
  do {
    let byte = value % 128;
    value = Math.floor(value / 128);
    if (value) byte |= 128;
    bytes.push(byte);
  } while (value);
  return Buffer.from(bytes);
}
function field(id, value) {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return Buffer.concat([integer(id * 8 + 2), integer(data.length), data]);
}
function fixture(address = encoded) {
  const item = Buffer.concat([
    Buffer.from([8, 255, 255, 255, 255, 255, 255, 255, 255, 127]),
    field(2, "1278370518365845248"),
    field(3, "ai-zh"),
    field(4, "中文"),
    field(5, address),
    field(60, "unknown future field"),
  ]);
  return field(1, field(3, item));
}
test("current web subtitle protobuf preserves 64-bit IDs and resolves the public transport URL", () => {
  const tracks = S.decodeSubtitleTracks(fixture());
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].lan_doc, "中文");
  assert.equal(tracks[0].id_str, "1278370518365845248");
  assert.equal(tracks[0].subtitle_url, expected);
  assert.equal(S.subtitleUrl(encoded), expected);
});
test("malformed subtitle protobuf and non-CDN subtitle addresses are rejected", () => {
  assert.throws(() => S.decodeSubtitleTracks(Buffer.from([10, 255])), /字幕/);
  assert.throws(
    () => S.decodeSubtitleTracks(Buffer.alloc(1024 * 1024 + 1)),
    /1MB/,
  );
  assert.throws(() => S.decodeSubtitleTracks(Buffer.from([9, 0])), /字幕/);
  assert.deepEqual(
    S.decodeSubtitleTracks(fixture("https://127.0.0.1/private")),
    [],
  );
  assert.deepEqual(
    S.decodeSubtitleTracks(fixture("https://hdslb.com.attacker.test/private")),
    [],
  );
});
function event() {
  const callbacks = [];
  return {
    addListener: (fn) => callbacks.push(fn),
    fire: (value) => callbacks.map((fn) => fn(value)),
  };
}
function background({ malformed = false } = {}) {
  const storage = {},
    requests = [],
    id = "test",
    chrome = {
      runtime: {
        id,
        getURL: (p) => "chrome-extension://test/" + p,
        onConnect: event(),
        onMessage: event(),
        connectNative: () => {
          throw Error("ASR must not run");
        },
      },
      storage: {
        local: {
          get: async (key) =>
            key === null ? { ...storage } : { [key]: storage[key] },
          set: async (value) => Object.assign(storage, value),
          remove: async (keys) => keys.forEach((k) => delete storage[k]),
        },
      },
    };
  const context = vm.createContext({
    chrome,
    crypto: crypto.webcrypto,
    URL,
    TextEncoder,
    TextDecoder,
    AbortController,
    AbortSignal,
    setTimeout,
    clearTimeout,
    console,
    fetch: async (url, options) => {
      requests.push({ url, credentials: options.credentials });
      if (url.includes("/nav"))
        return new Response(
          JSON.stringify({
            data: {
              wbi_img: {
                img_url:
                  "https://i0.hdslb.com/a/7cd084941338484aae1ad9425b84077c.png",
                sub_url:
                  "https://i0.hdslb.com/a/4932caff0ff746eab6f01bf08b70ac45.png",
              },
            },
          }),
        );
      if (url.includes("/subtitle/web/view")) {
        if (new URL(url).searchParams.get("web_location") !== "1315873")
          return new Response(Buffer.from([8, 0]));
        return new Response(malformed ? Buffer.from([10, 255]) : fixture(), {
          headers: { "content-type": "application/octet-stream" },
        });
      }
      if (url.includes("/player/wbi/v2"))
        return new Response(
          JSON.stringify({ code: 0, data: { subtitle: { subtitles: [] } } }),
        );
      if (url.startsWith("https://aisubtitle.hdslb.com/"))
        return new Response(
          JSON.stringify({
            body: [
              {
                from: 0.36,
                to: 3.22,
                content: "大众入股小鹏，绝对是完美之举。",
              },
            ],
          }),
        );
      throw Error("Unexpected URL");
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
  return { context, requests, storage };
}
const video = {
  bvid: "BV1ph4y1c7kp",
  aid: "616563515",
  cid: "1213740777",
  duration: 70,
  title: "测试视频",
  tracks: [],
};
test("a video with modern Chinese captions stays on official subtitles with ASR disabled", async () => {
  const app = background(),
    config = app.context.BiliConfig.normalize({ ai: { asrFallback: false } }),
    result = await app.context.loadSubtitles(
      video,
      "https://www.bilibili.com/video/" + video.bvid + "/",
      undefined,
      config,
    );
  assert.equal(result.source, "official");
  assert.equal(result.subtitles.length, 1);
  assert.equal(result.subtitles[0].start, 0.36);
  assert(app.requests.some((r) => r.url.includes("/subtitle/web/view")));
  assert(!app.requests.some((r) => r.url.includes("/player/wbi/v2")));
  assert.equal(
    app.requests.find((r) => r.url.includes("aisubtitle.hdslb.com"))
      .credentials,
    "omit",
  );
});
test("invalid modern metadata fails explicitly instead of silently starting a transcription", async () => {
  const app = background({ malformed: true });
  await assert.rejects(
    app.context.loadSubtitles(
      video,
      "https://www.bilibili.com/video/" + video.bvid + "/",
      undefined,
      app.context.BiliConfig.normalize(),
    ),
    /新字幕接口/,
  );
  assert.equal(app.requests.length, 2);
});
test("MAIN capture observes binary fetch and XHR while preserving the player response and nonempty tracks", async () => {
  const handlers = {},
    packets = [];
  function XHR() {
    this.listeners = {};
  }
  XHR.prototype.open = function () {};
  XHR.prototype.addEventListener = function (name, fn) {
    this.listeners[name] = fn;
  };
  XHR.prototype.send = function () {
    this.listeners.load?.();
  };
  const window = {
      __INITIAL_STATE__: {
        videoData: {
          bvid: video.bvid,
          aid: video.aid,
          cid: video.cid,
          duration: 70,
          pages: [{ cid: video.cid, duration: 70 }],
        },
      },
      fetch: async () => new Response(fixture()),
      addEventListener: (name, fn) => (handlers[name] = fn),
      dispatchEvent: (event) => packets.push(event),
    },
    location = {
      href: "https://www.bilibili.com/video/" + video.bvid + "/",
      pathname: "/video/" + video.bvid + "/",
    },
    context = vm.createContext({
      window,
      location,
      XMLHttpRequest: XHR,
      Map,
      WeakMap,
      URL,
      Response,
      TextEncoder,
      TextDecoder,
      setTimeout,
      clearTimeout,
      CustomEvent: function (type, options) {
        this.type = type;
        this.detail = options.detail;
      },
    });
  for (const file of ["subtitles.js", "capture.js"])
    vm.runInContext(
      fs.readFileSync(path.join(root, "extension", file), "utf8"),
      context,
    );
  const response = await window.fetch(
    "https://api.bilibili.com/x/v2/subtitle/web/view?oid=" +
      video.cid +
      "&pid=" +
      video.aid,
  );
  assert(Buffer.from(await response.arrayBuffer()).equals(fixture()));
  await new Promise(setImmediate);
  await new Promise(setImmediate);
  let xhr = new context.XMLHttpRequest();
  xhr.responseType = "arraybuffer";
  const binary = fixture();
  xhr.response = binary.buffer.slice(
    binary.byteOffset,
    binary.byteOffset + binary.byteLength,
  );
  xhr.open(
    "GET",
    "https://api.bilibili.com/x/v2/subtitle/web/view?oid=" +
      video.cid +
      "&pid=" +
      video.aid,
  );
  xhr.send();
  xhr = new context.XMLHttpRequest();
  xhr.responseType = "json";
  xhr.response = { data: { subtitle: { subtitles: [] } } };
  xhr.open(
    "GET",
    "https://api.bilibili.com/x/player/wbi/v2?cid=" +
      video.cid +
      "&aid=" +
      video.aid,
  );
  xhr.send();
  handlers["bili-codex-request"]({
    detail: JSON.stringify({ id: "captured" }),
  });
  const snapshot = JSON.parse(packets.at(-1).detail);
  assert.equal(snapshot.tracks.length, 1);
  assert.equal(snapshot.tracks[0].subtitle_url, expected);
  assert.equal(snapshot.cid, video.cid);
});
