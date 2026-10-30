"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
let files = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(js|cjs)$/.test(file)) {
      files++;
      const result = spawnSync(process.execPath, ["--check", file], {
        encoding: "utf8",
        windowsHide: true,
      });
      if (result.status !== 0) throw Error(result.stderr);
    }
  }
}
for (const folder of ["extension", "scripts", "tests"])
  walk(path.join(root, folder));
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"),
);
for (const script of [
  manifest.background.service_worker,
  manifest.action.default_popup,
  manifest.options_ui.page,
  ...manifest.content_scripts.flatMap((c) => c.js),
])
  if (!fs.existsSync(path.join(root, "extension", script)))
    throw Error("Missing manifest resource: " + script);
console.log(
  JSON.stringify({
    syntaxFiles: files,
    manifestResourcesPassed: true,
    version: manifest.version,
  }),
);
