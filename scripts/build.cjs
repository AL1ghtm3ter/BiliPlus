"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, ".."),
  source = path.join(root, "extension"),
  target = path.join(root, "dist", "extension");
// Rebuild only the fixed output directory, so removed features cannot survive a rebuild.
if (target !== path.join(root, "dist", "extension"))
  throw Error("Invalid build target");
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
fs.cpSync(source, target, { recursive: true, force: true });
console.log(
  JSON.stringify({
    version: JSON.parse(
      fs.readFileSync(path.join(source, "manifest.json"), "utf8"),
    ).version,
    extension: target,
    sourceMapsNeeded: false,
    minified: false,
  }),
);
