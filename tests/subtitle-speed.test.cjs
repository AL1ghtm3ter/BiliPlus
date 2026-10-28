"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  crypto = require("node:crypto");
const root = path.resolve(
  process.env.BILI_TEST_SOURCE_ROOT || path.join(__dirname, ".."),
);
const video = {
  bvid: "BV1ph4y1c7kp",
  aid: "616563515",
  cid: "1213740777",
  duration: 70,
  title: "字幕读取测试",
  tracks: [],
};
const pageUrl = "https://www.bilibili.com/video/" + video.bvid + "/";
const chinese = {
  lan: "zh-CN",
  lan_doc: "中文",
  subtitle_url: "https://aisubtitle.hdslb.com/zh.json",
};
const english = {
  lan: "en",
  subtitle_url: "https://aisubtitle.hdslb.com/en.json",
};
function field(id, text) {
  const value = Buffer.isBuffer(text) ? text : Buffer.from(text);
  assert(value.length < 128);
  return Buffer.concat([Buffer.from([id * 8 + 2, value.length]), value]);
}
function metadata(tracks) {
  return field(
    1,
    Buffer.concat(
      tracks.map((track) =>
        field(
          3,
          Buffer.concat([
            field(3, track.lan),
            field(4, track.lan_doc || track.lan),
            field(5, track.subtitle_url),
          ]),
        ),
      ),
    ),
  );
}
function event() {
  const handlers = [];
  return {
    addListener: (fn) => handlers.push(fn),
    fire: (...args) => handlers.forEach((fn) => fn(...args)),
  };
}
const flush = () => new Promise(setImmediate);
function background({ legacy = false, noTracks = false, info = video } = {}) {
  const storage = {},
    requests = [],
    pending = new Set(),
    native = [];
  let now = 0,
    cdnReads = 0;
  const chrome = {
    runtime: {
      id: "test",
      getURL: (p) => "chrome-extension://test/" + p,
      onConnect: event(),
      onMessage: event(),
      connectNative: () => {
        const port = {
          onMessage: event(),
          onDisconnect: event(),
          disconnect() {},
          postMessage(message) {
            native.push(message);
            assert.equal(message.type, "transcribe");
            queueMicrotask(() =>
              port.onMessage.fire({
                id: message.id,
                type: "result",
                result: {
                  ...message.input,
                  subtitles: [{ start: 0, end: 2, text: "本机转写" }],
                  source: "local-asr",
                },
              }),
            );
          },
        };
        return port;
      },
    },
    storage: {
      local: {
        get: async (key) =>
          key === null ? { ...storage } : { [key]: storage[key] },
        set: async (value) => Object.assign(storage, value),
        remove: async (keys) => keys.forEach((key) => delete storage[key]),
      },
    },
  };
  function response(url) {
    let json,
      binary,
      status = 200;
    if (url.pathname === "/x/web-interface/view")
      json = {
        code: 0,
        data: {
          ...info,
          pages: [{ cid: info.cid, duration: info.duration }],
        },
      };
    else if (url.pathname === "/x/web-interface/nav")
      json = {
        data: {
          wbi_img: {
            img_url:
              "https://i0.hdslb.com/7cd084941338484aae1ad9425b84077c.png",
            sub_url:
              "https://i0.hdslb.com/4932caff0ff746eab6f01bf08b70ac45.png",
          },
        },
      };
    else if (url.pathname === "/x/v2/subtitle/web/view") {
      if (legacy || noTracks) status = 404;
      else binary = metadata([english, chinese]);
    } else if (url.pathname === "/x/player/wbi/v2")
      json = {
        code: 0,
        data: { subtitle: { subtitles: noTracks ? [] : [english, chinese] } },
      };
    else if (url.pathname === "/x/player/wbi/playurl")
      json = {
        code: 0,
        data: {
          dash: {
            audio: [{ baseUrl: "https://audio.bilivideo.com/test.m4a" }],
          },
        },
      };
    else if (url.hostname === "aisubtitle.hdslb.com") {
      cdnReads++;
      json = {
        body: [
          {
            from: 0,
            to: 2,
            content:
              (url.pathname === "/zh.json" ? "中文字幕" : "English") + cdnReads,
          },
        ],
      };
    } else throw Error("Unexpected URL: " + url.href);
    return {
      ok: status === 200,
      status,
      headers: { get: () => null },
      json: async () => json,
      arrayBuffer: async () => binary,
    };
  }
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
    fetch: (raw, options) => {
      const url = new URL(raw),
        request = {
          url,
          started: now,
          credentials: options.credentials,
          redirect: options.redirect,
        };
      requests.push(request);
      return new Promise((resolve, reject) => {
        const item = {
          at:
            now +
            (["/x/web-interface/view", "/x/web-interface/nav"].includes(
              url.pathname,
            )
              ? 200
              : 100),
          complete() {
            pending.delete(item);
            options.signal?.removeEventListener("abort", abort);
            request.finished = now;
            resolve(response(url));
          },
        };
        const abort = () => {
          pending.delete(item);
          options.signal?.removeEventListener("abort", abort);
          request.cancelled = true;
          reject(options.signal.reason);
        };
        if (options.signal?.aborted) abort();
        else {
          options.signal?.addEventListener("abort", abort, { once: true });
          pending.add(item);
        }
      });
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
  async function run(promise) {
    let settled = false,
      result,
      error;
    const started = now;
    promise.then(
      (value) => ((result = value), (settled = true)),
      (reason) => ((error = reason), (settled = true)),
    );
    for (let turn = 0; !settled && turn < 100; turn++) {
      await flush();
      if (settled) break;
      assert(
        pending.size,
        "subtitle pipeline stalled without an active request",
      );
      now = Math.min(...Array.from(pending, (item) => item.at));
      for (const item of [...pending]) if (item.at <= now) item.complete();
    }
    assert(settled, "subtitle pipeline did not settle");
    if (error) throw error;
    return { result, elapsed: now - started };
  }
  const config = context.BiliConfig.normalize({ ai: { asrFallback: false } });
  return {
    context,
    requests,
    storage,
    native,
    pending,
    config,
    run,
    load: (snapshot = video, signal, force = false, chosenConfig = config) =>
      context.loadSubtitles(
        snapshot,
        pageUrl,
        signal,
        chosenConfig,
        undefined,
        force,
      ),
  };
}

function timing(t, scenario, h, elapsed) {
  t.diagnostic(
    JSON.stringify({
      scenario,
      syntheticNetworkMs: elapsed,
      requests: h.requests.length,
      navRequests: h.requests.filter((r) => r.url.pathname.endsWith("/nav"))
        .length,
    }),
  );
}

test("subtitle metadata resolves missing aid in parallel with WBI keys without changing Chinese preference", async (t) => {
  const h = background(),
    measured = await h.run(h.load({ ...video, aid: undefined }));
  timing(t, "missing-aid-modern", h, measured.elapsed);
  assert.equal(measured.elapsed, 400);
  assert.equal(measured.result.subtitles[0].text, "中文字幕1");
  assert.equal(h.requests.length, 4);
  assert.equal(
    h.requests.find((r) => r.url.pathname === "/x/web-interface/nav").started,
    h.requests.find((r) => r.url.pathname === "/x/web-interface/view").started,
  );
  const meta = h.requests.find((r) =>
    r.url.pathname.includes("/subtitle/web/view"),
  );
  assert.equal(meta.url.searchParams.get("oid"), video.cid);
  assert.equal(meta.url.searchParams.get("pid"), video.aid);
  assert.equal(h.native.length, 0);
});

test("modern-to-legacy subtitle fallback signs twice using one per-load nav request", async (t) => {
  const h = background({ legacy: true }),
    measured = await h.run(h.load());
  timing(t, "modern-to-legacy", h, measured.elapsed);
  assert.equal(measured.result.subtitles[0].text, "中文字幕1");
  assert.equal(measured.elapsed, 500);
  assert.equal(
    h.requests.filter((r) => r.url.pathname.endsWith("/nav")).length,
    1,
  );
  assert.equal(h.requests.length, 4);
  for (const r of h.requests.filter(
    (r) => r.url.hostname === "api.bilibili.com",
  )) {
    assert.equal(r.credentials, "include");
    assert.equal(r.redirect, "error");
  }
  const cdn = h.requests.find((r) => r.url.hostname === "aisubtitle.hdslb.com");
  assert.equal(cdn.credentials, "omit");
});

test("ASR audio fallback reuses per-load signing keys instead of fetching nav a third time", async (t) => {
  const h = background({ noTracks: true }),
    config = h.context.BiliConfig.normalize(),
    measured = await h.run(h.load(video, undefined, false, config));
  timing(t, "asr-audio-preparation-only", h, measured.elapsed);
  assert.equal(measured.elapsed, 500);
  assert.equal(measured.result.source, "local-asr");
  assert.equal(h.native.length, 1);
  assert.equal(
    h.requests.filter((r) => r.url.pathname.endsWith("/nav")).length,
    1,
  );
  assert.equal(h.requests.length, 4);
});

test("captured tracks read only one CDN, cached read makes no request, and force reread fetches fresh body", async () => {
  const h = background(),
    snapshot = { ...video, tracks: [english, chinese] };
  const first = await h.run(h.load(snapshot));
  assert.equal(first.elapsed, 100);
  const cached = await h.run(h.load(snapshot));
  assert.equal(cached.elapsed, 0);
  assert.equal(cached.result.subtitles[0].text, "中文字幕1");
  assert.equal(h.requests.length, 1);
  const fresh = await h.run(h.load(snapshot, undefined, true));
  assert.equal(fresh.result.subtitles[0].text, "中文字幕2");
  assert.equal(fresh.elapsed, 100);
  assert.equal(h.requests.length, 2);
});

test("cancelled missing-aid lookup aborts all parallel requests and preserves the abort reason", async () => {
  const h = background(),
    controller = new AbortController(),
    error = Error("用户取消读取字幕");
  const pending = h.load({ ...video, aid: undefined }, controller.signal);
  const rejected = assert.rejects(pending, (reason) => reason === error);
  await flush();
  controller.abort(error);
  await rejected;
  assert.equal(h.pending.size, 0);
  assert(h.requests.every((r) => r.cancelled));
  assert.equal(h.native.length, 0);
  assert.equal(Object.keys(h.storage).length, 0);
});

test("invalid captured CDN remains rejected before requests or native execution", async () => {
  const h = background();
  await assert.rejects(
    h.load({
      ...video,
      tracks: [
        { ...chinese, subtitle_url: "https://hdslb.com.attacker.test/x" },
      ],
    }),
    /字幕/,
  );
  assert.equal(h.requests.length, 0);
  assert.equal(h.native.length, 0);
});

test("signing errors remain explicit and are not cached across subsequent subtitle loads", async () => {
  const h = background(),
    failure = Error("签名请求被拒绝"),
    original = h.context.fetch;
  h.context.fetch = async () => {
    throw failure;
  };
  await assert.rejects(h.load(), (reason) => reason === failure);
  assert.equal(h.native.length, 0);
  assert.equal(Object.keys(h.storage).length, 0);
  h.context.fetch = original;
  const result = await h.run(h.load());
  assert.equal(result.result.subtitles[0].text, "中文字幕1");
  assert.equal(
    h.requests.filter((r) => r.url.pathname.endsWith("/nav")).length,
    1,
  );
});

test("force reread renews per-load signing keys and body instead of sharing a previous completed load", async () => {
  const h = background({ legacy: true });
  await h.run(h.load());
  const result = await h.run(h.load(video, undefined, true));
  assert.equal(result.result.subtitles[0].text, "中文字幕2");
  assert.equal(
    h.requests.filter((r) => r.url.pathname.endsWith("/nav")).length,
    2,
  );
  assert.equal(h.requests.length, 8);
});
