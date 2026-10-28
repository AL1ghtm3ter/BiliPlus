"use strict";
const { spawn } = require("node:child_process");
const path = require("node:path");

function launchRuntime(runtimePath, deps = {}) {
  const windows = (deps.platform || process.platform) === "win32";
  const child = (deps.spawn || spawn)(
    windows
      ? deps.runtimeHostPath || path.join(__dirname, "RuntimeHost.exe")
      : runtimePath,
    windows ? [runtimePath] : ["serve"],
    {
      shell: false,
      windowsHide: true,
      stdio: windows ? ["pipe", "ignore", "ignore"] : "ignore",
      detached: true,
      env: { ...(deps.env || process.env), OLLAMA_HOST: "127.0.0.1:11434" },
    },
  );
  // Only the GUI host is detached. Its console application is created using
  // CREATE_NO_WINDOW, so ordinary descendants inherit a hidden console.
  child.stdin?.on("error", () => {});
  let settled = false;
  return {
    child,
    release() {
      if (settled) return;
      settled = true;
      child.stdin?.end();
      child.unref?.();
    },
    cancel() {
      if (settled) return;
      settled = true;
      if (windows) child.stdin?.end("cancel\n");
      else child.kill();
    },
  };
}
module.exports = { launchRuntime };
