"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const cp = require("node:child_process");
const { launchRuntime } = require("../native/runtime-start.cjs");

const compiler = path.join(
  process.env.WINDIR || "C:/Windows",
  "Microsoft.NET/Framework64/v4.0.30319/csc.exe",
);
const supported = process.platform === "win32" && fs.existsSync(compiler);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function receiptLines(file, wanted) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const lines = fs.existsSync(file)
      ? fs
          .readFileSync(file, "utf8")
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
    if (lines.length >= wanted) return lines;
    await pause(50);
  }
  throw Error("Synthetic runtime receipt timed out");
}

function fixture() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "biliplus-console-qa-"));
  const source = path.join(folder, "Fixture.cs");
  const binary = path.join(folder, "ollama.exe");
  const receipt = path.join(folder, "receipt.jsonl");
  const host = path.join(folder, "RuntimeHost.exe");
  fs.writeFileSync(
    source,
    `using System;
using System.IO;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
class Fixture {
  [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr handle);
  static void Record(string kind) {
    IntPtr handle=GetConsoleWindow();
    string line="{\\"kind\\":\\""+kind+"\\",\\"pid\\":"+Process.GetCurrentProcess().Id+",\\"console\\":"+handle.ToInt64()+",\\"visible\\":"+(IsWindowVisible(handle)?"true":"false")+"}";
    File.AppendAllText(Environment.GetEnvironmentVariable("BILIPLUS_QA_RECEIPT"),line+Environment.NewLine);
  }
  static int Main(string[] args) {
    if(args.Length>0 && args[0]=="probe") { Record("descendant");Thread.Sleep(300);return 0; }
    Record("server");
    var info=new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName,"probe");
    info.UseShellExecute=false;
    using(var child=Process.Start(info)) {child.WaitForExit();}
    Thread.Sleep(1000);
    Record("heartbeat");
    string stop=Environment.GetEnvironmentVariable("BILIPLUS_QA_RECEIPT")+".stop";
    for(int n=0;n<400 && !File.Exists(stop);n++)Thread.Sleep(50);
    return 0;
  }
}`,
  );
  cp.execFileSync(
    compiler,
    ["/nologo", "/target:exe", "/out:" + binary, source],
    { windowsHide: true },
  );
  cp.execFileSync(
    compiler,
    [
      "/nologo",
      "/target:winexe",
      "/out:" + host,
      path.resolve(__dirname, "../native/RuntimeHost.cs"),
    ],
    { windowsHide: true },
  );
  return { folder, binary, receipt, host };
}

test(
  "Windows runtime keeps an unflagged console descendant hidden",
  { skip: !supported },
  async () => {
    const f = fixture();
    const launch = launchRuntime(f.binary, {
      runtimeHostPath: f.host,
      env: { ...process.env, BILIPLUS_QA_RECEIPT: f.receipt },
    });
    try {
      const lines = await receiptLines(f.receipt, 2);
      console.log("Console fixture receipts: " + JSON.stringify(lines));
      assert.equal(lines.find((line) => line.kind === "server").visible, false);
      assert.equal(
        lines.find((line) => line.kind === "descendant").visible,
        false,
        "The runtime's ordinary child opened a visible console",
      );
    } finally {
      launch.cancel();
      fs.writeFileSync(f.receipt + ".stop", "stop");
      await pause(750);
      const absolute = path.resolve(f.folder);
      assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()));
      assert(path.basename(absolute).startsWith("biliplus-console-qa-"));
      fs.rmSync(absolute, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    }
  },
);

test(
  "Windows runtime stays alive after its initiating bridge exits",
  { skip: !supported },
  async () => {
    const f = fixture();
    const modulePath = path.resolve(__dirname, "../native/runtime-start.cjs");
    const driver = `const fs=require('node:fs');const {launchRuntime}=require(${JSON.stringify(modulePath)});const launch=launchRuntime(${JSON.stringify(f.binary)},{runtimeHostPath:${JSON.stringify(f.host)}});const timer=setInterval(()=>{if(fs.existsSync(process.env.BILIPLUS_QA_RECEIPT)&&fs.readFileSync(process.env.BILIPLUS_QA_RECEIPT,'utf8').trim().split(/\\r?\\n/).length>=2){clearInterval(timer);launch.release();}},20);`;
    const child = cp.spawn(process.execPath, ["-e", driver], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, BILIPLUS_QA_RECEIPT: f.receipt },
    });
    let errors = "";
    child.stderr.on("data", (chunk) => (errors += chunk));
    try {
      const exit = await Promise.race([
        new Promise((resolve) => child.once("exit", (code) => resolve(code))),
        pause(6000).then(() => {
          throw Error("Bridge failed to exit: " + errors);
        }),
      ]);
      assert.equal(exit, 0, errors);
      const lines = await receiptLines(f.receipt, 3);
      assert.equal(
        lines.at(-1).kind,
        "heartbeat",
        "The runtime died with the bridge",
      );
    } finally {
      if (child.exitCode === null) child.kill();
      fs.writeFileSync(f.receipt + ".stop", "stop");
      await pause(750);
      const absolute = path.resolve(f.folder);
      assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()));
      assert(path.basename(absolute).startsWith("biliplus-console-qa-"));
      fs.rmSync(absolute, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    }
  },
);

test(
  "Windows preparation cancellation stops the service created by its GUI host",
  { skip: !supported },
  async () => {
    const f = fixture();
    const launch = launchRuntime(f.binary, {
      runtimeHostPath: f.host,
      env: { ...process.env, BILIPLUS_QA_RECEIPT: f.receipt },
    });
    try {
      await receiptLines(f.receipt, 2);
      const exited = new Promise((resolve) =>
        launch.child.once("exit", resolve),
      );
      launch.cancel();
      await Promise.race([
        exited,
        pause(4000).then(() => {
          throw Error("Cancelled runtime did not exit");
        }),
      ]);
      await pause(1200);
      const lines = fs
        .readFileSync(f.receipt, "utf8")
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line));
      assert.equal(
        lines.some((line) => line.kind === "heartbeat"),
        false,
        "Only the host exited; its service was left running",
      );
    } finally {
      launch.cancel();
      fs.writeFileSync(f.receipt + ".stop", "stop");
      await pause(750);
      const absolute = path.resolve(f.folder);
      assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()));
      assert(path.basename(absolute).startsWith("biliplus-console-qa-"));
      fs.rmSync(absolute, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    }
  },
);
