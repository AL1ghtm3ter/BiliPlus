"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  cp = require("node:child_process");
const root = path.resolve(__dirname, ".."),
  compiler = path.join(
    process.env.WINDIR || "C:/Windows",
    "Microsoft.NET/Framework64/v4.0.30319/csc.exe",
  ),
  powershell = path.join(
    process.env.WINDIR || "C:/Windows",
    "System32/WindowsPowerShell/v1.0/powershell.exe",
  );
const supported =
  process.platform === "win32" &&
  fs.existsSync(compiler) &&
  fs.existsSync(powershell);
test(
  "downloaded one-click CMD preserves paths, invokes explicit model preparation and propagates failure without running a real installer",
  { skip: !supported },
  () => {
    const base = fs.mkdtempSync(
        path.join(os.tmpdir(), "biliplus-launcher-qa-"),
      ),
      folder = path.join(base, "BiliPlus & new user"),
      bin = path.join(base, "bin"),
      receipt = path.join(base, "receipt.txt");
    fs.mkdirSync(folder);
    fs.mkdirSync(bin);
    try {
      const launcher = fs.readFileSync(
        path.join(root, "BiliPlus-configure-local-ai.cmd"),
      );
      assert.deepEqual(
        launcher,
        fs.readFileSync(
          path.join(root, "extension/setup/configure-local-ai.cmd"),
        ),
      );
      assert(
        !/[^\x00-\x7f]/.test(launcher.toString()),
        "CMD stays portable across Windows code pages",
      );
      fs.writeFileSync(
        path.join(folder, "BiliPlus-configure-local-ai.cmd"),
        launcher,
      );
      const source = path.join(base, "Fake.cs"),
        fake = path.join(bin, "powershell.exe");
      fs.writeFileSync(
        source,
        `using System;using System.IO;class Fake {static int Main(string[] args){File.WriteAllLines(Environment.GetEnvironmentVariable("BILIPLUS_QA_RECEIPT"),new[]{Environment.GetEnvironmentVariable("BILIPLUS_SETUP_ROOT"),String.Join("\\n",args)});return Int32.Parse(Environment.GetEnvironmentVariable("BILIPLUS_QA_EXIT"));}}`,
      );
      cp.execFileSync(
        compiler,
        ["/nologo", "/target:exe", "/out:" + fake, source],
        { windowsHide: true },
      );
      for (const exit of [0, 7]) {
        const result = cp.spawnSync(
          process.env.ComSpec || "C:/Windows/System32/cmd.exe",
          ["/d", "/c", "BiliPlus-configure-local-ai.cmd"],
          {
            cwd: folder,
            env: {
              ...process.env,
              PATH: bin + path.delimiter + process.env.PATH,
              BILIPLUS_QA_RECEIPT: receipt,
              BILIPLUS_QA_EXIT: String(exit),
            },
            input: "\r\n",
            encoding: "utf8",
            windowsHide: true,
            timeout: 10000,
          },
        );
        assert.ifError(result.error);
        assert.equal(result.status, exit, result.stdout + result.stderr);
        const captured = fs
          .readFileSync(receipt, "utf8")
          .replace(/^\ufeff/, "");
        assert(
          captured.startsWith(folder + path.sep + "\r\n") ||
            captured.startsWith(folder + path.sep + "\n"),
          "selected package path is passed as data",
        );
        assert.match(captured, /-ExecutionPolicy\r?\nBypass/);
        assert.match(captured, /& \$installer -PrepareModel/);
        assert(
          !fs.existsSync(path.join(folder, "native/runtime.json")),
          "no real bridge or model is installed",
        );
      }
      const command = launcher
        .toString()
        .match(/-Command "([^\r\n]+)"\r?\n/)[1];
      assert(command.length < 7000, "fits Windows command line budget");
      const script = path.join(base, "inline.ps1");
      fs.writeFileSync(script, command);
      const parse = cp.spawnSync(
        powershell,
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          "$tokens=$null;$errors=$null;[void][Management.Automation.Language.Parser]::ParseFile($env:BILIPLUS_QA_SCRIPT,[ref]$tokens,[ref]$errors);if($errors.Count){throw ($errors|Out-String)};Write-Output 'PARSE_OK'",
        ],
        {
          env: { ...process.env, BILIPLUS_QA_SCRIPT: script },
          encoding: "utf8",
          windowsHide: true,
          timeout: 10000,
        },
      );
      assert.ifError(parse.error);
      assert.equal(parse.status, 0, parse.stdout + parse.stderr);
      assert.match(parse.stdout, /PARSE_OK/);
    } finally {
      const absolute = path.resolve(base);
      assert(
        absolute.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
          path.basename(absolute).startsWith("biliplus-launcher-qa-"),
      );
      fs.rmSync(absolute, { recursive: true, force: true });
    }
  },
);
