"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, ".."),
  source = path.join(root, "extension"),
  target = path.join(root, "dist", "extension");
// Copy readable source verbatim. Never delete arbitrary or computed parent directories.
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
