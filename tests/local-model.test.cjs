"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  { EventEmitter } = require("node:events");
const L = require("../native/local-model.cjs");
const schema = {
  type: "object",
  additionalProperties: false,
  required: ["summary"],
  properties: { summary: { type: "string" } },
};
const fixture = {
  model: L.DEFAULT_MODEL,
  kind: "summary",
  prompt: "根据合成字幕生成总结。字幕：每轮工作25分钟，休息5分钟。",
  schema,
};
const json = (value) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
function ndjson(chunks) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks)
          controller.enqueue(
            typeof chunk === "string" ? Buffer.from(chunk) : chunk,
          );
        controller.close();
      },
    }),
    { headers: { "content-type": "application/x-ndjson" } },
  );
}
function harness({
  ready = true,
  installed = true,
  modelReady = true,
  signature = "Valid",
  signatureSubject = "CN=Ollama Inc., O=Ollama Inc.",
  pull,
  chat,
  tags,
  downloadRedirect,
} = {}) {
  const calls = [],
    processes = [],
    spawned = [],
    progress = [];
  const state = { ready, installed, modelReady };
  const runtime = path.resolve(os.tmpdir(), "qa-ollama", "ollama.exe");
  const deps = {
    platform: "win32",
    env: { LOCALAPPDATA: path.resolve(os.tmpdir(), "qa-local-user"), PATH: "" },
    findRuntime: () => (state.installed ? runtime : null),
    sleep: async () => {},
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.startsWith("https://")) {
        if (downloadRedirect)
          return new Response(null, {
            status: 302,
            headers: { location: downloadRedirect },
          });
        return new Response(
          Buffer.from("MZ synthetic installer; never executed"),
        );
      }
      assert(
        url.startsWith("http://127.0.0.1:11434/"),
        "only the fixed loopback endpoint is allowed",
      );
      assert.equal(options.redirect, "error");
      if (!state.ready) throw TypeError("synthetic ECONNREFUSED");
      if (url.endsWith("/api/version")) return json({ version: "0.34.0" });
      if (url.endsWith("/api/tags"))
        return tags
          ? tags()
          : json({
              models: state.modelReady
                ? [{ name: L.DEFAULT_MODEL, size: 2500000000 }]
                : [],
            });
      if (url.endsWith("/api/pull")) {
        if (pull) return pull({ state, options });
        state.modelReady = true;
        const row = Buffer.from(
          JSON.stringify({ status: "下载模型", total: 100, completed: 25 }) +
            "\n" +
            JSON.stringify({ status: "success" }) +
            "\n",
        );
        return ndjson([
          row.subarray(0, 8),
          row.subarray(8, 19),
          row.subarray(19),
        ]);
      }
      if (url.endsWith("/api/chat"))
        return chat
          ? chat(options)
          : json({
              done: true,
              done_reason: "stop",
              message: { content: '{"summary":"合成总结"}' },
            });
      throw Error("Unexpected mock path");
    },
    spawn: (binary, args, options) => {
      const child = new EventEmitter();
      child.killed = false;
      child.kill = () => {
        child.killed = true;
      };
      child.unref = () => {};
      spawned.push({ binary, args, options, child });
      state.ready = true;
      return child;
    },
    runProcess: async (binary, args, options) => {
      processes.push({ binary, args, options });
      if (binary.endsWith("powershell.exe"))
        return {
          stdout: JSON.stringify({
            status: signature,
            subject: signatureSubject,
            thumbprint: "A".repeat(40),
          }),
        };
      state.installed = true;
      return { stdout: "" };
    },
  };
  return {
    deps,
    calls,
    processes,
    spawned,
    state,
    progress,
    onProgress: (p) => progress.push(p),
    runtime,
  };
}
test("local status probes a fixed loopback service without installing or pulling", async () => {
  const h = harness(),
    state = await L.status({}, h.deps);
  assert.equal(state.backend, "local");
  assert.equal(state.runtimeReady, true);
  assert.equal(state.modelReady, true);
  assert.equal(state.version, "0.34.0");
  assert.equal(state.model, "qwen3:4b");
  assert.equal(state.installedRuntime, true);
  assert.equal(h.calls.length, 2);
  assert.equal(h.processes.length, 0);
  assert.equal(h.spawned.length, 0);
});
test("local model names reject cloud, remote URLs, command-like strings and unsupported names before I/O", async () => {
  for (const model of [
    "qwen3:4b:cloud",
    "qwen3:cloud",
    "https://remote.example/model",
    "qwen3:4b;whoami",
    "qwen2.5:0.5b",
    "../qwen3:4b",
  ]) {
    const h = harness();
    await assert.rejects(L.prepare({ model }, h.deps), /仅支持本地/);
    await assert.rejects(
      L.runLocal({ ...fixture, model }, h.deps),
      /仅支持本地/,
    );
    assert.equal(h.calls.length, 0);
  }
});
test("local status makes an absent runtime explicit without a side-effect", async () => {
  const h = harness({ ready: false, installed: false }),
    s = await L.status({}, h.deps);
  assert.equal(s.runtimeReady, false);
  assert.equal(s.modelReady, false);
  assert.equal(s.installedRuntime, false);
  assert.equal(h.processes.length, 0);
  assert.equal(h.spawned.length, 0);
});
test("prepare reuses an existing server and installed model, never starts or stops it", async () => {
  const h = harness(),
    result = await L.prepare({ onProgress: h.onProgress }, h.deps);
  assert.equal(result.modelReady, true);
  assert.equal(
    h.calls.some((c) => c.url.endsWith("/api/pull")),
    false,
  );
  assert.equal(h.spawned.length, 0);
  assert.equal(h.processes.length, 0);
  assert.equal(h.progress.at(-1).stage, "local-ready");
});
test("prepare starts only a missing installed server with shell disabled and a child-only loopback bind", async () => {
  const h = harness({ ready: false }),
    before = process.env.OLLAMA_HOST;
  const result = await L.prepare({ onProgress: h.onProgress }, h.deps);
  assert.equal(result.runtimeReady, true);
  assert.equal(h.spawned.length, 1);
  assert.deepEqual(h.spawned[0].args, ["serve"]);
  assert.equal(h.spawned[0].options.shell, false);
  assert.equal(h.spawned[0].options.windowsHide, true);
  assert.equal(h.spawned[0].options.env.OLLAMA_HOST, "127.0.0.1:11434");
  assert.equal(process.env.OLLAMA_HOST, before);
  assert.equal(h.spawned[0].child.killed, false);
  assert.equal(h.processes.length, 0);
});
test("prepare downloads an absent model and parses split UTF-8 NDJSON progress before readiness", async () => {
  const h = harness({ modelReady: false }),
    result = await L.prepare({ onProgress: h.onProgress }, h.deps);
  assert.equal(result.modelReady, true);
  const pull = h.calls.find((c) => c.url.endsWith("/api/pull"));
  assert.deepEqual(JSON.parse(pull.options.body), {
    model: L.DEFAULT_MODEL,
    stream: true,
  });
  const row = h.progress.find((p) => p.completed === 25);
  assert.equal(row.status, "下载模型");
  assert.equal(row.total, 100);
  assert.equal(row.percent, 25);
  assert.equal(row.progressScope, "layer");
  assert.equal(h.progress.at(-1).stage, "local-ready");
});
test("prepare fails on download errors, malformed progress and missing success", async () => {
  for (const body of [
    '{"error":"network unavailable"}\n',
    "invalid\n",
    '{"status":"pulling"}\n',
  ]) {
    const h = harness({ modelReady: false, pull: () => ndjson([body]) });
    await assert.rejects(L.prepare({}, h.deps), /下载失败|无效进度|未完成/);
    assert.equal(
      h.calls.some((c) => c.url.endsWith("/api/chat")),
      false,
    );
  }
});
test("cancelling model download aborts the request and never generates a result", async () => {
  const c = new AbortController(),
    h = harness({ modelReady: false });
  await assert.rejects(
    L.runLocal(
      {
        ...fixture,
        signal: c.signal,
        onProgress: (p) => {
          if (p.completed === 25) c.abort();
        },
      },
      h.deps,
    ),
    /abort|取消/i,
  );
  assert.equal(
    h.calls.find((x) => x.url.endsWith("/api/pull")).options.signal.aborted,
    true,
  );
  assert.equal(
    h.calls.some((x) => x.url.endsWith("/api/chat")),
    false,
  );
  assert.equal(h.spawned.length, 0);
});
test("runLocal automatically prepares the model then uses schema, disabled thinking and no tools", async () => {
  const h = harness({ modelReady: false }),
    result = await L.runLocal({ ...fixture, onProgress: h.onProgress }, h.deps);
  assert.deepEqual(result, { summary: "合成总结" });
  const chat = h.calls.find((c) => c.url.endsWith("/api/chat")),
    body = JSON.parse(chat.options.body);
  assert.equal(body.model, L.DEFAULT_MODEL);
  assert.equal(body.think, false);
  assert.equal(body.stream, false);
  assert.deepEqual(body.format, schema);
  assert.equal(body.tools, undefined);
  assert.equal(body.messages.length, 2);
  assert.match(body.messages[0].content, /不可信数据/);
  assert.equal(body.messages[1].content, fixture.prompt);
  assert(body.options.num_ctx <= 4096);
  assert.equal(h.progress.at(-1).stage, "local-complete");
  assert(
    h.calls.findIndex((c) => c.url.endsWith("/api/pull")) <
      h.calls.findIndex((c) => c.url.endsWith("/api/chat")),
  );
});
test("long prompts select a larger bounded context while oversized prompts fail before preparation without truncation", async () => {
  const h = harness();
  const prompt = "合成字幕。".repeat(1200);
  await L.runLocal({ ...fixture, prompt }, h.deps);
  const body = JSON.parse(
    h.calls.find((c) => c.url.endsWith("/api/chat")).options.body,
  );
  assert(body.options.num_ctx > 4096);
  assert(body.options.num_ctx <= 32768);
  assert.equal(body.messages[1].content, prompt);
  const blocked = harness();
  await assert.rejects(
    L.runLocal({ ...fixture, prompt: "字".repeat(20000) }, blocked.deps),
    /输入过长.*没有截断字幕/,
  );
  assert.equal(blocked.calls.length, 0);
});
test("the combined prompt limit counts UTF-8 bytes exactly and does not truncate at the boundary", async () => {
  const probe = harness();
  await L.runLocal(fixture, probe.deps);
  const sent = JSON.parse(
    probe.calls.find((c) => c.url.endsWith("/api/chat")).options.body,
  );
  const available =
    L.MAX_PROMPT_BYTES - Buffer.byteLength(sent.messages[0].content, "utf8");
  const prompt =
    "字".repeat(Math.floor(available / 3)) + "x".repeat(available % 3);
  assert(prompt.length < available, "character count is not the byte budget");
  const boundary = harness();
  await L.runLocal({ ...fixture, prompt }, boundary.deps);
  const accepted = JSON.parse(
    boundary.calls.find((c) => c.url.endsWith("/api/chat")).options.body,
  );
  assert.equal(accepted.messages[1].content, prompt);
  assert.equal(
    Buffer.byteLength(accepted.messages.map((m) => m.content).join(""), "utf8"),
    L.MAX_PROMPT_BYTES,
  );
  assert.equal(accepted.options.num_ctx, 32768);
  const over = harness();
  await assert.rejects(
    L.runLocal({ ...fixture, prompt: prompt + "x" }, over.deps),
    /28001 字节.*28000 字节.*没有截断字幕/,
  );
  assert.equal(
    over.calls.length,
    0,
    "oversized input is rejected before preparation/network I/O",
  );
});
test("completion reports only six safe Ollama timing/token metrics and preserves the model result", async () => {
  const h = harness({
    chat: () =>
      json({
        done: true,
        done_reason: "stop",
        message: { content: '{"summary":"合成总结"}' },
        load_duration: 40610000000,
        prompt_eval_duration: 36918000000,
        eval_duration: 7748000000,
        total_duration: 87658000000,
        prompt_eval_count: 474,
        eval_count: 381,
        context: ["sensitive context must not be copied"],
        arbitrarySecret: "not a metric",
      }),
  });
  const result = await L.runLocal(
    { ...fixture, onProgress: h.onProgress },
    h.deps,
  );
  assert.deepEqual(result, { summary: "合成总结" });
  assert.deepEqual(h.progress.at(-1), {
    backend: "local",
    stage: "local-complete",
    status: "本地模型处理完成",
    model: L.DEFAULT_MODEL,
    metrics: {
      loadMs: 40610,
      promptMs: 36918,
      generateMs: 7748,
      totalMs: 87658,
      promptTokens: 474,
      outputTokens: 381,
    },
  });
  const sent = JSON.parse(
    h.calls.find((c) => c.url.endsWith("/api/chat")).options.body,
  );
  assert.equal(
    sent.keep_alive,
    "2m",
    "diagnostics must not change model lifetime",
  );
});
test("completion ignores malformed, negative or unsafe metrics without losing a valid result", async () => {
  const values = [
    {
      load_duration: "12",
      prompt_eval_duration: -1,
      eval_duration: null,
      total_duration: "Infinity",
      prompt_eval_count: 1.5,
      eval_count: -2,
    },
    {
      load_duration: 0,
      prompt_eval_duration: 125000,
      eval_duration: Number.MAX_VALUE,
      total_duration: Number.MAX_SAFE_INTEGER + 1,
      prompt_eval_count: Number.MAX_SAFE_INTEGER + 1,
      eval_count: 0,
    },
  ];
  for (const [i, metrics] of values.entries()) {
    const h = harness({
      chat: () =>
        json({
          done: true,
          message: { content: '{"summary":"合成总结"}' },
          ...metrics,
        }),
    });
    assert.deepEqual(
      await L.runLocal({ ...fixture, onProgress: h.onProgress }, h.deps),
      { summary: "合成总结" },
    );
    assert.deepEqual(
      h.progress.at(-1).metrics,
      i ? { loadMs: 0, promptMs: 0.125, outputTokens: 0 } : {},
    );
  }
});
test("local generation rejects invalid JSON, scalar/array output, tools and incomplete responses", async () => {
  const cases = [
    [{ done: true, message: { content: "not json" } }, /有效 JSON/],
    [{ done: true, message: { content: "null" } }, /JSON 对象/],
    [{ done: true, message: { content: "[]" } }, /JSON 对象/],
    [{ done: true, message: { content: "{}", tool_calls: [{}] } }, /工具调用/],
    [{ done: false, message: { content: "{}" } }, /未完整生成/],
    [
      { done: true, done_reason: "length", message: { content: "{}" } },
      /未完整生成/,
    ],
  ];
  for (const [value, error] of cases) {
    const h = harness({ chat: () => json(value) });
    await assert.rejects(L.runLocal(fixture, h.deps), error);
  }
});
test("local generation caps streamed response bytes and claimed content length", async () => {
  for (const claimed of [true, false]) {
    const h = harness({
      chat: () =>
        new Response("x".repeat(2 * 1024 * 1024 + 1), {
          headers: claimed
            ? { "content-length": String(2 * 1024 * 1024 + 1) }
            : {},
        }),
    });
    await assert.rejects(L.runLocal(fixture, h.deps), /超过大小限制/);
  }
});
test("local generation timeout aborts even a fetch implementation that ignores its signal", async () => {
  const h = harness({ chat: () => new Promise(() => {}) });
  await assert.rejects(
    L.runLocal({ ...fixture, timeoutMs: 15 }, h.deps),
    /生成超时/,
  );
  assert.equal(
    h.calls.find((c) => c.url.endsWith("/api/chat")).options.signal.aborted,
    true,
  );
});
test("external cancellation aborts generation without stopping the user's existing Ollama server", async () => {
  const c = new AbortController(),
    h = harness({ chat: () => new Promise(() => {}) });
  const pending = L.runLocal({ ...fixture, signal: c.signal }, h.deps);
  for (
    let n = 0;
    n < 20 && !h.calls.some((x) => x.url.endsWith("/api/chat"));
    n++
  )
    await new Promise(setImmediate);
  c.abort();
  await assert.rejects(pending, /abort|取消/i);
  assert.equal(h.spawned.length, 0);
  assert.equal(h.processes.length, 0);
});
test("cloud aliases in model metadata are rejected rather than called", async () => {
  const h = harness({
    tags: () =>
      json({
        models: [{ name: L.DEFAULT_MODEL, remote_host: "https://ollama.com" }],
      }),
  });
  await assert.rejects(L.runLocal(fixture, h.deps), /云模型/);
  assert.equal(
    h.calls.some((c) => c.url.endsWith("/api/chat")),
    false,
  );
  assert.equal(
    h.spawned.length,
    0,
    "metadata failure must not restart a running service",
  );
});
async function withInstaller(options, work) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bili-local-test-"));
  try {
    const h = harness({ ready: false, installed: false, ...options });
    h.deps.tempRoot = dir;
    await work(h, dir);
  } finally {
    const resolved = path.resolve(dir);
    if (
      resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
      path.basename(resolved).startsWith("bili-local-test-")
    )
      await fs.rm(resolved, { recursive: true, force: true });
  }
}
test("missing Windows runtime uses official HTTPS download and verified signature before a user-directory silent install", async () => {
  await withInstaller({}, async (h, dir) => {
    const result = await L.prepare({ onProgress: h.onProgress }, h.deps);
    assert.equal(result.runtimeReady, true);
    assert.equal(
      h.calls.find((c) => c.url.startsWith("https://")).url,
      "https://ollama.com/download/OllamaSetup.exe",
    );
    assert(h.processes[0].binary.endsWith("powershell.exe"));
    assert(
      h.processes[0].options.env.BILI_LOCAL_INSTALLER.endsWith(
        "OllamaSetup.exe",
      ),
    );
    const install = h.processes[1];
    assert(install.binary.endsWith("OllamaSetup.exe"));
    assert(install.args.includes("/VERYSILENT"));
    assert(
      install.args.some(
        (a) =>
          a ===
          "/DIR=" + path.join(h.deps.env.LOCALAPPDATA, "Programs", "Ollama"),
      ),
    );
    assert(
      h.progress.some(
        (p) =>
          p.stage === "local-runtime-verify" && /^[0-9a-f]{64}$/.test(p.sha256),
      ),
    );
    assert.deepEqual(
      await fs.readdir(dir),
      [],
      "temporary installer removed after success",
    );
  });
});
test("missing Windows runtime never executes an invalid or wrong-publisher signed download", async () => {
  for (const options of [
    { signature: "NotSigned" },
    { signatureSubject: "CN=Unrelated Vendor" },
  ])
    await withInstaller(options, async (h, dir) => {
      await assert.rejects(L.prepare({}, h.deps), /签名无效|发布者不符/);
      assert.equal(h.processes.length, 1);
      assert.equal(h.spawned.length, 0);
      assert.deepEqual(await fs.readdir(dir), []);
    });
});
test("installer redirects cannot leave official HTTPS hosts and cleanup still runs", async () => {
  await withInstaller(
    { downloadRedirect: "https://attacker.example/setup.exe" },
    async (h, dir) => {
      await assert.rejects(L.prepare({}, h.deps), /非 Ollama 官方来源/);
      assert.equal(h.processes.length, 0);
      assert.equal(
        h.calls.filter((c) => c.url.startsWith("https://")).length,
        1,
      );
      assert.deepEqual(await fs.readdir(dir), []);
    },
  );
});
test("a model-list HTTP error reports a running runtime without starting or pulling anything", async () => {
  const h = harness({
    tags: () =>
      new Response(JSON.stringify({ error: "temporarily unavailable" }), {
        status: 503,
      }),
  });
  const state = await L.status({}, h.deps);
  assert.equal(state.runtimeReady, true);
  assert.equal(state.modelReady, false);
  assert.equal(state.version, "0.34.0");
  await assert.rejects(L.prepare({}, h.deps), /temporarily unavailable/);
  assert.equal(h.spawned.length, 0);
  assert.equal(h.processes.length, 0);
  assert.equal(
    h.calls.some((c) => c.url.endsWith("/api/pull")),
    false,
  );
});
test("cancel during official runtime download prevents verification/installation and removes temporary bytes", async () => {
  await withInstaller({}, async (h, dir) => {
    const controller = new AbortController();
    await assert.rejects(
      L.prepare(
        {
          signal: controller.signal,
          onProgress: (p) => {
            if (p.stage === "local-runtime-download") controller.abort();
          },
        },
        h.deps,
      ),
      /abort|取消/i,
    );
    assert.equal(h.processes.length, 0);
    assert.equal(h.spawned.length, 0);
    assert.deepEqual(await fs.readdir(dir), []);
  });
});
test("cancel after signature verification prevents installer execution", async () => {
  await withInstaller({}, async (h, dir) => {
    const controller = new AbortController();
    await assert.rejects(
      L.prepare(
        {
          signal: controller.signal,
          onProgress: (p) => {
            if (p.stage === "local-runtime-install") controller.abort();
          },
        },
        h.deps,
      ),
      /abort|取消/i,
    );
    assert.equal(h.processes.length, 1, "only signature verification ran");
    assert.equal(h.spawned.length, 0);
    assert.deepEqual(await fs.readdir(dir), []);
  });
});
test("startup cancellation stops only the child this preparation started", async () => {
  const h = harness({ ready: false }),
    controller = new AbortController();
  h.deps.spawn = (...args) => {
    const child = new EventEmitter();
    child.killed = false;
    child.kill = () => {
      child.killed = true;
    };
    child.unref = () => {};
    h.spawned.push({ args, child });
    return child;
  };
  h.deps.sleep = () => new Promise(() => {});
  const pending = L.prepare({ signal: controller.signal }, h.deps);
  for (let n = 0; n < 20 && !h.spawned.length; n++)
    await new Promise(setImmediate);
  controller.abort();
  await assert.rejects(pending, /abort|取消/i);
  assert.equal(h.spawned.length, 1);
  assert.equal(h.spawned[0].child.killed, true);
});
test("an existing non-Windows machine without Ollama gets an explicit install requirement", async () => {
  const h = harness({ ready: false, installed: false });
  h.deps.platform = "linux";
  await assert.rejects(
    L.prepare({}, h.deps),
    /先从 https:\/\/ollama.com\/download 安装/,
  );
  assert.equal(h.processes.length, 0);
  assert.equal(h.spawned.length, 0);
});
