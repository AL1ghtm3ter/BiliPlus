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
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise(setImmediate);
};
const replyUrl =
  "https://api.bilibili.com/x/v2/reply/wbi/main?oid=123&type=1&mode=3&w_rid=public-fixture";
const reply = (rpid, uid, location) => ({
  rpid_str: String(rpid),
  member: { mid: String(uid) },
  reply_control: { location },
});
function harness(settings = { player: { commentIp: true } }) {
  const { window, document } = parseHTML(
    '<!doctype html><html><body><div id="commentapp"><bili-comments></bili-comments></div></body></html>',
  );
  const location = {
    href: "https://www.bilibili.com/video/BV1ph4y1c7kp/",
    pathname: "/video/BV1ph4y1c7kp/",
    search: "",
    hostname: "www.bilibili.com",
  };
  window.location = location;
  const calls = [],
    packets = [],
    intervals = new Map(),
    storageListeners = [];
  let timer = 0,
    payload = { code: 0, data: { replies: [] } };
  const nativeFetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify(payload), {
      headers: { "content-type": "application/json" },
    });
  };
  window.fetch = nativeFetch;
  window.addEventListener("bili-codex-data", (e) =>
    packets.push(JSON.parse(e.detail)),
  );
  class XHR {
    open() {}
    send() {}
    addEventListener() {}
  }
  const chrome = {
    storage: {
      local: {
        get: async () => ({ biliSettings: settings }),
        set: async () => {},
      },
      onChanged: { addListener: (fn) => storageListeners.push(fn) },
    },
  };
  const context = vm.createContext({
    window,
    document,
    location,
    chrome,
    URL,
    Request,
    Response,
    Map,
    Set,
    WeakMap,
    TextEncoder,
    TextDecoder,
    AbortController,
    XMLHttpRequest: XHR,
    CustomEvent: window.CustomEvent,
    Event: window.Event,
    setInterval: (fn) => {
      const id = ++timer;
      intervals.set(id, fn);
      return id;
    },
    clearInterval: (id) => intervals.delete(id),
    setTimeout,
    clearTimeout,
    console,
  });
  const load = (name) =>
    vm.runInContext(fs.readFileSync(path.join(root, name), "utf8"), context, {
      filename: name,
    });
  load("capture.js");
  const commentsRoot = document
    .querySelector("bili-comments")
    .attachShadow({ mode: "open" });
  function addName(rpid, uid) {
    const thread = document.createElement("bili-comment-thread-renderer");
    if (rpid !== null) thread.setAttribute("data-rpid", String(rpid));
    commentsRoot.append(thread);
    const renderer = document.createElement("bili-comment-renderer");
    thread.attachShadow({ mode: "open" }).append(renderer);
    const info = document.createElement("bili-comment-user-info");
    renderer.attachShadow({ mode: "open" }).append(info);
    const shadow = info.attachShadow({ mode: "open" });
    shadow.innerHTML =
      '<div id="user-name" data-user-profile-id="' + uid + '">昵称</div>';
    return shadow.querySelector("#user-name");
  }
  const boot = async () => {
    for (const file of [
      "common/config.js",
      "features/runtime.js",
      "features/player.js",
      "features/index.js",
    ])
      load(file);
    await settle();
  };
  return {
    window,
    document,
    location,
    calls,
    packets,
    addName,
    boot,
    setPayload: (value) => {
      payload = value;
    },
    captureConfig: (value) =>
      window.dispatchEvent(
        new window.CustomEvent("bili-codex-config", {
          detail: JSON.stringify(value),
        }),
      ),
    state: () => context.BiliFeatures.context,
    scan: () => {
      for (const fn of [...intervals.values()]) fn();
    },
    async fetch(value = replyUrl) {
      const response = await window.fetch(value);
      await response.json();
      await settle();
    },
  };
}
const badge = (name) => name.querySelector("[data-bcx-ip]")?.textContent;

test("public reply metadata reaches modern data-user-profile-id inside nested ShadowDOM", async () => {
  const h = harness(),
    name = h.addName("9001", "42");
  await h.boot();
  h.setPayload({
    code: 0,
    data: { replies: [reply("9001", "42", "IP属地：广东")] },
  });
  await h.fetch();
  h.scan();
  assert.equal(badge(name), "广东");
});

test("a reply completed before idle configuration is recovered once after comment IP is enabled", async () => {
  const h = harness(),
    name = h.addName("9001", "42");
  h.setPayload({
    code: 0,
    data: { replies: [reply("9001", "42", "IP属地：广东")] },
  });
  await h.fetch();
  assert.equal(
    h.packets.filter((p) => p.comments).length,
    0,
    "disabled capture must not read the initial reply body",
  );
  await h.boot();
  h.scan();
  assert.equal(badge(name), "广东");
  assert.equal(
    h.calls.length,
    2,
    "one initial page request and one bounded recovery GET",
  );
  assert.deepEqual(JSON.parse(JSON.stringify(h.state().commentIpDiagnostics)), {
    records: 1,
    painted: 1,
    recoveries: 1,
    error: "",
  });
  h.captureConfig({ commentIp: true });
  await settle();
  h.scan();
  assert.equal(
    h.calls.length,
    2,
    "configuration acknowledgements must not repeat recovery requests",
  );
});

test("metadata emitted before the isolated listener exists is replayed during the configuration handshake", async () => {
  const h = harness(),
    name = h.addName("9001", "42");
  h.captureConfig({ commentIp: true });
  h.setPayload({
    code: 0,
    data: { replies: [reply("9001", "42", "IP属地：广东")] },
  });
  await h.fetch();
  await h.boot();
  h.scan();
  assert.equal(badge(name), "广东");
  assert.equal(
    h.calls.length,
    1,
    "retained public metadata should replay without another network request",
  );
});

test("exact reply locations win and conflicting locations for the same UID never create a guessed badge", async () => {
  const h = harness(),
    first = h.addName("9001", "42"),
    second = h.addName("9002", "42"),
    unknown = h.addName(null, "42");
  await h.boot();
  h.setPayload({
    code: 0,
    data: {
      replies: [
        reply("9001", "42", "IP属地：广东"),
        reply("9002", "42", "IP属地：浙江"),
      ],
    },
  });
  await h.fetch();
  h.scan();
  assert.equal(badge(first), "广东");
  assert.equal(badge(second), "浙江");
  assert.equal(badge(unknown), undefined);
});

test("pinned and nested replies preserve public locations, missing or non-string values never render", async () => {
  const h = harness(),
    admin = h.addName("9001", "41"),
    nested = h.addName("9002", "42"),
    missing = h.addName("9003", "43");
  await h.boot();
  h.setPayload({
    code: 0,
    data: {
      top: { admin: reply("9001", "41", " IP 属地 ： 北京 ") },
      replies: [
        {
          ...reply("8999", "40", ""),
          replies: [
            reply("9002", "42", "IP属地：上海"),
            reply("9003", "43", { location: "fake" }),
          ],
        },
      ],
    },
  });
  await h.fetch();
  h.scan();
  assert.equal(badge(admin), "北京");
  assert.equal(badge(nested), "上海");
  assert.equal(badge(missing), undefined);
});

test("disabling comment IP removes nested badges and does not fetch or observe subsequent comment bodies", async () => {
  const h = harness(),
    name = h.addName("9001", "42");
  await h.boot();
  h.setPayload({
    code: 0,
    data: { replies: [reply("9001", "42", "IP属地：广东")] },
  });
  await h.fetch();
  h.scan();
  assert.equal(badge(name), "广东");
  h.state().patch("player.commentIp", false);
  await settle();
  h.scan();
  assert.equal(badge(name), undefined);
  const packets = h.packets.filter((p) => p.comments).length;
  await h.fetch();
  h.scan();
  assert.equal(h.packets.filter((p) => p.comments).length, packets);
  assert.equal(badge(name), undefined);
});

test("recycled usernames clear old badges and a known unmatched reply never borrows another reply's UID location", async () => {
  const h = harness(),
    name = h.addName("9001", "42"),
    unmatched = h.addName("9999", "42");
  await h.boot();
  h.setPayload({
    code: 0,
    data: { replies: [reply("9001", "42", "IP属地：广东")] },
  });
  await h.fetch();
  h.scan();
  assert.equal(badge(name), "广东");
  assert.equal(badge(unmatched), undefined);
  name.setAttribute("data-user-profile-id", "43");
  name
    .getRootNode()
    .host.getRootNode()
    .host.getRootNode()
    .host.setAttribute("data-rpid", "9003");
  h.scan();
  assert.equal(badge(name), undefined);
});

test("large comment trees are not cut off at 160 shadow roots and disabling cleans every owned badge", async () => {
  const h = harness(),
    names = [];
  for (let i = 0; i < 180; i++)
    names.push(h.addName(String(9000 + i), String(100 + i)));
  await h.boot();
  h.setPayload({
    code: 0,
    data: {
      replies: names.map((_, i) =>
        reply(String(9000 + i), String(100 + i), "IP属地：广东"),
      ),
    },
  });
  await h.fetch();
  h.scan();
  assert.equal(names.filter((n) => badge(n) === "广东").length, 180);
  h.state().patch("player.commentIp", false);
  h.scan();
  assert.equal(names.filter((n) => badge(n)).length, 0);
});

test("video changes reject late replies from the old page and clear previously rendered locations", async () => {
  const h = harness(),
    old = h.addName("9001", "42");
  await h.boot();
  h.setPayload({
    code: 0,
    data: { replies: [reply("9001", "42", "IP属地：广东")] },
  });
  await h.fetch();
  h.scan();
  assert.equal(badge(old), "广东");
  const pending = h.window.fetch(replyUrl);
  h.location.pathname = "/video/BV1Q4411x7qA/";
  h.location.href = "https://www.bilibili.com" + h.location.pathname;
  h.scan();
  await (await pending).json();
  await settle();
  h.scan();
  assert.equal(badge(old), undefined);
  const next = h.addName("9002", "42");
  h.setPayload({
    code: 0,
    data: { replies: [reply("9002", "42", "IP属地：上海")] },
  });
  await h.fetch(replyUrl.replace("oid=123", "oid=456"));
  h.scan();
  assert.equal(badge(next), "上海");
  assert.equal(badge(old), undefined);
});

test("recovery never repeats a POST or starts after comment IP has been switched off", async () => {
  const h = harness();
  h.setPayload({
    code: 0,
    data: { replies: [reply("9001", "42", "IP属地：广东")] },
  });
  await (await h.window.fetch(replyUrl, { method: "POST" })).json();
  await h.boot();
  h.scan();
  assert.equal(h.calls.length, 1);
  const cancelled = harness();
  await cancelled.fetch();
  cancelled.captureConfig({ commentIp: true });
  cancelled.captureConfig({ commentIp: false });
  await settle();
  assert.equal(cancelled.calls.length, 1);
  assert.equal(cancelled.packets.filter((p) => p.comments).length, 0);
});

test("recovery diagnostics expose only bounded counters and API error codes", async () => {
  const h = harness();
  h.setPayload({
    code: -412,
    message: "fixture body with private comment text",
  });
  await h.fetch();
  await h.boot();
  h.scan();
  assert.deepEqual(JSON.parse(JSON.stringify(h.state().commentIpDiagnostics)), {
    records: 0,
    painted: 0,
    recoveries: 1,
    error: "API_-412",
  });
  h.state().patch("player.commentIp", false);
  assert.deepEqual(JSON.parse(JSON.stringify(h.state().commentIpDiagnostics)), {
    records: 0,
    painted: 0,
    recoveries: 0,
    error: "",
  });
});
