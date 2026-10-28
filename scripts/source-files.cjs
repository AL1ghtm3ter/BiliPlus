"use strict";
const fs = require("node:fs"),
  path = require("node:path");
// The same explicit source tree is used for the ZIP and the public repository.
// Machine data, original-extension analysis and historical evidence are excluded.
function sourceFiles(root) {
  const files = [];
  function add(name) {
    const full = path.join(root, name),
      stat = fs.lstatSync(full);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw Error("Not a regular source file: " + name);
    files.push(name);
  }
  function walk(folder, allowed) {
    for (const item of fs.readdirSync(path.join(root, folder), {
      withFileTypes: true,
    })) {
      const name = folder + "/" + item.name;
      if (item.isSymbolicLink())
        throw Error("Source tree cannot contain links: " + name);
      if (item.isDirectory()) walk(name, allowed);
      else if (allowed(name)) add(name);
    }
  }
  walk("extension", (name) => /\.(?:js|css|html|svg|png|json|cmd)$/.test(name));
  walk("tests", (name) => /\.test\.cjs$/.test(name));
  for (const name of [
    "native/Launcher.cs",
    "native/RuntimeHost.cs",
    "native/runtime-start.cjs",
    "native/host.cjs",
    "native/runner.cjs",
    "native/tasks.cjs",
    "native/local-model.cjs",
    "native/local-summary.cjs",
    "native/setup-local.cjs",
    "native/asr.cjs",
    "native/asr.py",
    "native/setup_asr.py",
    "native/requirements-asr.txt",
    "native/requirements-asr.lock.txt",
    "native/summary.schema.json",
    "native/chat.schema.json",
    "native/ads.schema.json",
    "native/polish.schema.json",
    "native/job/AGENTS.md",
    "scripts/source-files.cjs",
    "scripts/build.cjs",
    "scripts/check.cjs",
    "scripts/package.cjs",
    "scripts/bootstrap-node.ps1",
    "scripts/render-icons.py",
    "README.md",
    "FEATURES.md",
    "ARCHITECTURE.md",
    "CHANGELOG.md",
    "LOGO.md",
    "MODEL-SETUP-UI.md",
    "THIRD-PARTY-NOTICES.md",
    "RELEASE-TESTS.md",
    "LICENSE",
    "CONTRIBUTING.md",
    "SECURITY.md",
    ".github/workflows/ci.yml",
    "package.json",
    "package-lock.json",
    ".gitignore",
    ".gitattributes",
    "extension-id.txt",
    "BiliPlus-configure-local-ai.cmd",
    "安装本机桥接.ps1",
    "安装本机转写.ps1",
    "卸载本机桥接.ps1",
  ])
    add(name);
  return files.sort();
}
module.exports = { sourceFiles };
