"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const root = path.resolve(
  process.env.BILI_TEST_SOURCE_ROOT || path.join(__dirname, ".."),
);
const flush = () => new Promise(setImmediate);

function harness({
  response = new Response("{}"),
  failure,
  throwEvents = false,
} = {}) {
  const handlers = new Map(),
    fetches = [],
    packets = [],
    xhrs = [];
  const pending = failure ? Promise.reject(failure) : Promise.resolve(response);
  // A rejected native promise is observed by the test after the wrapper is ready.
  pending.catch(() => {});
  const window = {
    fetch: function (...args) {
      fetches.push({ receiver: this, args });
      return pending;
    },
    addEventListener: (type, fn) => handlers.set(type, fn),
    dispatchEvent(event) {
      if (throwEvents) throw Error("observer unavailable");
      packets.push(event);
    },
  };
  class XHR {
    constructor() {
      this.listeners = new Map();
      this.responseType = "";
      this.reads = 0;
      this.body = "{}";
      xhrs.push(this);
    }
    open(...args) {
      this.nativeArgs = args;
      this.nativeUrl = String(args[1]);
      return "native-open";
    }
    send(...args) {
      this.sent = args;
      return "native-send";
    }
    addEventListener(type, fn, options) {
      const list = this.listeners.get(type) || [];
      list.push({ fn, once: options?.once });
      this.listeners.set(type, list);
    }
    removeEventListener(type, fn) {
      this.listeners.set(
        type,
        (this.listeners.get(type) || []).filter((x) => x.fn !== fn),
      );
    }
    fire(type) {
      for (const item of [...(this.listeners.get(type) || [])]) {
        item.fn();
        if (item.once) this.removeEventListener(type, item.fn);
      }
    }
    get responseText() {
      this.reads++;
      return this.body;
    }
  }
  const context = vm.createContext({
    window,
    location: {
      href: "https://www.bilibili.com/video/BV1ph4y1c7kp/",
      pathname: "/video/BV1ph4y1c7kp/",
    },
    XMLHttpRequest: XHR,
    URL,
    Response,
    Map,
    WeakMap,
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    CustomEvent: class {
      constructor(type, options) {
        this.type = type;
        Object.assign(this, options);
      }
    },
  });
  vm.runInContext(
    fs.readFileSync(path.join(root, "extension/capture.js"), "utf8"),
    context,
  );
  return {
    window,
    XHR,
    pending,
    response,
    fetches,
    xhrs,
    packets,
    handlers,
    configure: (value) =>
      handlers.get("bili-codex-config")({ detail: JSON.stringify(value) }),
  };
}

test("page fetch keeps the original promise, response, receiver and request arguments", async () => {
  const response = new Response(JSON.stringify({ data: { replies: [] } }));
  const h = harness({ response }),
    receiver = {},
    init = { credentials: "include" },
    input = new Request("https://api.bilibili.com/x/v2/reply/main?oid=1");
  const actual = h.window.fetch.call(receiver, input, init);
  assert.equal(actual, h.pending);
  assert.equal(await actual, response);
  assert.equal(h.fetches[0].receiver, receiver);
  assert.equal(h.fetches[0].args[0], input);
  assert.equal(h.fetches[0].args[1], init);
  assert.deepEqual(await response.json(), { data: { replies: [] } });
  await flush();
});

test("thumbnail fetches do not clone or consume the image response", async () => {
  const response = {
    clone() {
      throw Error("thumbnail body must stay untouched");
    },
  };
  const h = harness({ response });
  assert.equal(
    await h.window.fetch("https://i0.hdslb.com/bfs/archive/cover.webp"),
    response,
  );
  await flush();
});

test("unrelated Bilibili API responses are not read by the capture observer", async () => {
  let clones = 0;
  const response = {
    clone() {
      clones++;
      return { json: async () => ({}) };
    },
  };
  const h = harness({ response });
  assert.equal(
    await h.window.fetch(
      "https://api.bilibili.com/x/space/wbi/arc/search?mid=1",
    ),
    response,
  );
  await flush();
  assert.equal(
    clones,
    0,
    "capture must only inspect the endpoints its features use",
  );
});

test("native fetch rejection retains the exact rejection and promise", async () => {
  const failure = new Error("network rejection fixture"),
    h = harness({ failure });
  const actual = h.window.fetch(
    "https://api.bilibili.com/x/v2/reply/main?oid=1",
  );
  assert.equal(actual, h.pending);
  await assert.rejects(actual, (error) => error === failure);
  await flush();
});

test("capture event or decoder failures do not change a successful player response", async () => {
  const bytes = Uint8Array.of(8, 0),
    response = new Response(bytes),
    h = harness({ response, throwEvents: true });
  assert.equal(
    await h.window.fetch(
      "https://api.bilibili.com/x/v2/subtitle/web/view?oid=1",
    ),
    response,
  );
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  await flush();
});

test("XHR URL coercion is performed only by native open and open retains its native arguments", () => {
  const h = harness(),
    request = new h.XHR();
  let conversions = 0;
  const address = {
    toString() {
      conversions++;
      return "https://api.bilibili.com/x/v2/reply/main?oid=1";
    },
  };
  assert.equal(
    request.open("GET", address, true, "user", "password"),
    "native-open",
  );
  assert.equal(request.nativeArgs[1], address);
  assert.equal(
    conversions,
    1,
    "observer must not run WebIDL string conversion an extra time",
  );
});

test("XHR observer listener registration cannot prevent the native comment request from being sent", () => {
  const h = harness(),
    request = new h.XHR(),
    body = "request-body";
  h.configure({ commentIp: true });
  request.open("GET", "https://api.bilibili.com/x/v2/reply/main?oid=1");
  request.addEventListener = () => {
    throw Error("observer listener rejected");
  };
  assert.equal(request.send(body), "native-send");
  assert.equal(request.sent[0], body);
});

test("unrelated XHR responses are not read and page response handlers retain their data", () => {
  const h = harness(),
    request = new h.XHR();
  request.body = JSON.stringify({
    data: { pic: "//i0.hdslb.com/avatar.webp" },
  });
  request.open("GET", "https://api.bilibili.com/x/member/web/account");
  request.send();
  request.fire("load");
  assert.equal(request.reads, 0);
  assert.deepEqual(JSON.parse(request.responseText), {
    data: { pic: "//i0.hdslb.com/avatar.webp" },
  });
});

test("comment responses pass through unread until public comment location is enabled", async () => {
  let clones = 0;
  const response = {
    clone() {
      clones++;
      return { json: async () => ({ data: { replies: [] } }) };
    },
  };
  const h = harness({ response }),
    url = "https://api.bilibili.com/x/v2/reply/main?oid=1";
  await h.window.fetch(url);
  const plain = new h.XHR();
  plain.open("GET", url);
  plain.send();
  plain.fire("load");
  await flush();
  assert.equal(clones, 0);
  assert.equal(plain.reads, 0);
  assert.equal(plain.listeners.get("load")?.length || 0, 0);
  h.configure({ commentIp: true });
  await h.window.fetch(url);
  const observed = new h.XHR();
  observed.open("GET", url);
  observed.send();
  observed.fire("load");
  await flush();
  assert.equal(clones, 1);
  assert.equal(observed.reads, 1);
});

test("feed metadata is read only when an enhancement requests it, including history compatibility", async () => {
  let clones = 0;
  const response = {
    clone() {
      clones++;
      return { json: async () => ({ data: { item: [] } }) };
    },
  };
  const h = harness({ response }),
    url = "https://api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd";
  await h.window.fetch(url);
  await flush();
  assert.equal(clones, 0);
  h.configure({ videoMetadata: true });
  await h.window.fetch(url);
  await flush();
  assert.equal(clones, 1);
  h.configure({ videoMetadata: false, history: false });
  await h.window.fetch(url);
  await flush();
  assert.equal(clones, 1);
  h.configure({ history: true });
  await h.window.fetch(url);
  await flush();
  assert.equal(clones, 2);
});
