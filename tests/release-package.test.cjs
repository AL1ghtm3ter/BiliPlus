const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, ".."),
  { sourceFiles } = require("../scripts/source-files.cjs");
test("public source tree excludes generated host state, historical captures and original analysis", () => {
  const files = sourceFiles(root);
  assert.equal(new Set(files).size, files.length);
  for (const name of files) {
    assert(!path.isAbsolute(name) && !name.split(/[\\/]/).includes(".."));
    assert(
      !/(^|\/)(work|dist|node_modules|\.runtime|__pycache__)(\/|$)/.test(name),
    );
    assert(!/\.(?:zip|exe|jpg|log|tap)$/.test(name));
    assert(
      !/(?:runtime\.json|node-path\.txt|last-status\.json|local\.bilibili_codex\.json|REA-)/.test(
        name,
      ),
    );
  }
  for (const name of [
    "LICENSE",
    ".gitattributes",
    ".github/workflows/ci.yml",
    "native/setup-local.cjs",
    "native/local-summary.cjs",
    "scripts/bootstrap-node.ps1",
    "scripts/source-files.cjs",
    "extension/icons/icon128.png",
    "BiliPlus-configure-local-ai.cmd",
    "extension/setup/configure-local-ai.cmd",
  ])
    assert(files.includes(name), name);
});
test("release versions and manifest icon dimensions agree in the portable tree", () => {
  const pkg = require("../package.json"),
    manifest = require("../extension/manifest.json");
  assert.equal(manifest.version, pkg.version);
  assert.equal(require("../native/runner.cjs").VERSION, pkg.version);
  assert.equal(pkg.license, "MIT");
  for (const [size, name] of Object.entries(manifest.icons)) {
    const data = fs.readFileSync(path.join(root, "extension", name));
    assert.equal(data.subarray(1, 4).toString(), "PNG");
    assert.equal(data.readUInt32BE(16), Number(size));
    assert.equal(data.readUInt32BE(20), Number(size));
    assert.equal(manifest.action.default_icon[size], name);
  }
});
test("overlong custom instructions are rejected without silent truncation", () => {
  const { prepare } = require("../native/tasks.cjs"),
    prompt = "甲".repeat(10001);
  assert.throws(() => prepare("summary", { prompt }), /没有截断/);
  assert.equal(
    prepare("summary", { prompt: prompt.slice(0, -1) }).prompt.length,
    10000,
  );
});
