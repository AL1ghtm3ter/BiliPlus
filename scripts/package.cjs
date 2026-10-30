"use strict";
// A dependency-free ZIP writer for this small source distribution (no ZIP64).
const fs = require("node:fs"),
  path = require("node:path"),
  zlib = require("node:zlib"),
  crypto = require("node:crypto");
const root = path.resolve(__dirname, ".."),
  version = require("../package.json").version;
const { sourceFiles } = require("./source-files.cjs");
const entries = sourceFiles(root);
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
const checks =
  entries
    .map(
      (name) =>
        crypto
          .createHash("sha256")
          .update(fs.readFileSync(path.join(root, name)))
          .digest("hex") +
        "  " +
        name,
    )
    .join("\n") + "\n";
const files = entries.map((name) => ({
  name,
  data: fs.readFileSync(path.join(root, name)),
}));
files.push({ name: "SHA256SUMS.txt", data: Buffer.from(checks) });
const local = [],
  central = [];
let offset = 0;
for (const file of files) {
  const name = Buffer.from("BiliPlus/" + file.name, "utf8"),
    packed = zlib.deflateRawSync(file.data),
    crc = crc32(file.data),
    header = Buffer.alloc(30),
    index = Buffer.alloc(46);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x800, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(33, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(packed.length, 18);
  header.writeUInt32LE(file.data.length, 22);
  header.writeUInt16LE(name.length, 26);
  index.writeUInt32LE(0x02014b50, 0);
  index.writeUInt16LE(20, 4);
  index.writeUInt16LE(20, 6);
  index.writeUInt16LE(0x800, 8);
  index.writeUInt16LE(8, 10);
  index.writeUInt16LE(33, 14);
  index.writeUInt32LE(crc, 16);
  index.writeUInt32LE(packed.length, 20);
  index.writeUInt32LE(file.data.length, 24);
  index.writeUInt16LE(name.length, 28);
  index.writeUInt32LE(offset, 42);
  local.push(header, name, packed);
  central.push(index, name);
  offset += header.length + name.length + packed.length;
}
const catalog = Buffer.concat(central),
  end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(catalog.length, 12);
end.writeUInt32LE(offset, 16);
const target = path.join(root, "dist", "BiliPlus-" + version + "-source.zip");
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, Buffer.concat([...local, catalog, end]));
console.log(
  JSON.stringify({
    path: target,
    files: files.length,
    bytes: fs.statSync(target).size,
    sha256: crypto
      .createHash("sha256")
      .update(fs.readFileSync(target))
      .digest("hex"),
    excluded: [
      ".runtime",
      "node_modules",
      "dist",
      "native runtimes, models and installers",
    ],
  }),
);
