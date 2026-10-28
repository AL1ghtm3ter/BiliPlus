(function (root) {
  "use strict";
  const order = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
    61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
    36, 20, 34, 44, 52,
  ];
  function md5(text) {
    const bytes = new TextEncoder().encode(text),
      length = Math.ceil((bytes.length + 9) / 64) * 64,
      buffer = new Uint8Array(length);
    buffer.set(bytes);
    buffer[bytes.length] = 128;
    const view = new DataView(buffer.buffer);
    view.setUint32(length - 8, (bytes.length * 8) >>> 0, true);
    view.setUint32(length - 4, Math.floor(bytes.length / 0x20000000), true);
    let states = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
    const shifts = [
      [7, 12, 17, 22],
      [5, 9, 14, 20],
      [4, 11, 16, 23],
      [6, 10, 15, 21],
    ];
    for (let offset = 0; offset < length; offset += 64) {
      let [a, b, c, d] = states;
      for (let i = 0; i < 64; i++) {
        let f, g;
        if (i < 16) {
          f = (b & c) | (~b & d);
          g = i;
        } else if (i < 32) {
          f = (d & b) | (~d & c);
          g = (5 * i + 1) % 16;
        } else if (i < 48) {
          f = b ^ c ^ d;
          g = (3 * i + 5) % 16;
        } else {
          f = c ^ (b | ~d);
          g = (7 * i) % 16;
        }
        const sum =
            (a +
              f +
              Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) +
              view.getUint32(offset + 4 * g, true)) >>>
            0,
          s = shifts[Math.floor(i / 16)][i % 4];
        const next = (b + ((sum << s) | (sum >>> (32 - s)))) >>> 0;
        a = d;
        d = c;
        c = b;
        b = next;
      }
      states = states.map((v, i) => (v + [a, b, c, d][i]) >>> 0);
    }
    return states
      .map((v) =>
        [0, 8, 16, 24]
          .map((s) => ((v >>> s) & 255).toString(16).padStart(2, "0"))
          .join(""),
      )
      .join("");
  }
  function wbiQuery(params, img, sub, now = Date.now()) {
    const key = (s) => new URL(s).pathname.split("/").pop().split(".")[0];
    const source = key(img) + key(sub);
    if (source.length !== 64) throw Error("B站签名信息无效，请刷新后重试。");
    const mix = order
      .map((i) => source[i])
      .join("")
      .slice(0, 32);
    const values = { ...params, wts: Math.floor(now / 1000) };
    const query = Object.keys(values)
      .sort()
      .map(
        (k) =>
          encodeURIComponent(k) +
          "=" +
          encodeURIComponent(String(values[k]).replace(/[!'()*]/g, "")),
      )
      .join("&");
    return query + "&w_rid=" + md5(query + mix);
  }
  function subtitleUrl(value) {
    if (typeof value !== "string" || value.length > 8192)
      throw Error("字幕地址无效。");
    let url = new URL(value.startsWith("//") ? "https:" + value : value);
    if (
      url.hostname === "subtitle.bilibili.com" &&
      url.protocol === "https:" &&
      !url.port &&
      !url.username &&
      !url.password
    ) {
      // Public transport format used by B站's current web player. Only the
      // resulting hdslb URL is fetched; this does not change access permissions.
      const formats = [
        [
          'nP](wOFRvU.+<fjS{jn-!$D|Dz&",zT`',
          "=CFxYRn{.y|uVyO$uh&sikph?N.ilF/`",
        ],
        [
          'Bn"q~|albg@]Go~ACgyDvKnd+)_D}^&J?',
          "Cu~L!xs~f^&r@'vh=q]q{eeng*sEg^kp#J",
        ],
      ];
      const encoded = decodeURIComponent(url.pathname.slice(1));
      let decoded = "";
      for (const [prefix, salt] of formats) {
        const key = salt + "bilibili",
          plain = Array.from(encoded, (char, i) =>
            String.fromCharCode(
              char.charCodeAt(0) ^ key.charCodeAt(i % key.length),
            ),
          ).join("");
        if (plain.startsWith(prefix)) {
          decoded = plain.slice(prefix.length);
          break;
        }
      }
      if (!decoded.startsWith("/") || /[\x00-\x1f\x7f]/.test(decoded))
        throw Error("B站返回了无法识别的字幕地址，请刷新后重试。");
      url = new URL("https://aisubtitle.hdslb.com" + decoded + url.search);
    }
    if (
      url.protocol !== "https:" ||
      !(url.hostname === "hdslb.com" || url.hostname.endsWith(".hdslb.com")) ||
      url.port ||
      url.username ||
      url.password
    )
      throw Error("字幕地址不属于 B站字幕服务。");
    return url.href;
  }
  function protobufFields(input) {
    const bytes = ArrayBuffer.isView(input)
      ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      : new Uint8Array(input);
    if (bytes.length > 1024 * 1024) throw Error("字幕元数据超过 1MB。");
    let offset = 0,
      count = 0;
    const fields = [];
    function integer() {
      let value = 0n;
      for (let i = 0; i < 10; i++) {
        if (offset >= bytes.length) throw Error("字幕元数据不完整。");
        const byte = bytes[offset++];
        if (i === 9 && byte > 1) throw Error("字幕元数据整数无效。");
        value |= BigInt(byte & 127) << BigInt(i * 7);
        if (!(byte & 128)) return value;
      }
      throw Error("字幕元数据整数过长。");
    }
    while (offset < bytes.length) {
      if (++count > 4096) throw Error("字幕元数据字段过多。");
      const tag = integer(),
        id = Number(tag >> 3n),
        wire = Number(tag & 7n);
      if (!id || id > 536870911) throw Error("字幕元数据字段无效。");
      if (wire === 0) integer();
      else if (wire === 2) {
        const length = Number(integer());
        if (
          !Number.isSafeInteger(length) ||
          length < 0 ||
          length > bytes.length - offset
        )
          throw Error("字幕元数据长度无效。");
        fields.push({ id, bytes: bytes.subarray(offset, offset + length) });
        offset += length;
      } else if (wire === 1) offset += 8;
      else if (wire === 5) offset += 4;
      else throw Error("字幕元数据类型不支持。");
      if (offset > bytes.length) throw Error("字幕元数据不完整。");
    }
    return fields;
  }
  function decodeSubtitleTracks(input, { legacyDm = false } = {}) {
    const roots = protobufFields(input).filter((field) =>
        legacyDm ? [9, 20].includes(field.id) : field.id === 1,
      ),
      tracks = [],
      decoder = new TextDecoder("utf-8", { fatal: true });
    for (const root of roots)
      for (const item of protobufFields(root.bytes)
        .filter((field) => field.id === 3)
        .slice(0, 32)) {
        const fields = protobufFields(item.bytes),
          text = (id) => {
            const field = fields.find((field) => field.id === id);
            return field ? decoder.decode(field.bytes) : "";
          };
        const address = text(5);
        if (!address) continue;
        try {
          tracks.push({
            id_str: text(2).slice(0, 80),
            lan: text(3).slice(0, 40),
            lan_doc: text(4).slice(0, 80),
            subtitle_url: subtitleUrl(address),
          });
        } catch {
          /* Ignore unsupported addresses without exposing non-subtitle metadata. */
        }
      }
    return tracks;
  }
  function pickTrack(tracks) {
    return tracks
      .filter((t) => t?.subtitle_url)
      .sort((a, b) => {
        const rank = (t) =>
          /^(zh|ai-zh)/.test(t.lan || "") ? 0 : /^en/.test(t.lan || "") ? 1 : 2;
        return rank(a) - rank(b);
      })[0];
  }
  function normalizeBody(body) {
    if (!Array.isArray(body) || !body.length) throw Error("字幕内容为空。");
    return body
      .map((s) => ({
        start: Number(s.from),
        end: Number(s.to),
        text: String(s.content || "").trim(),
      }))
      .filter(
        (s) =>
          s.text &&
          Number.isFinite(s.start) &&
          Number.isFinite(s.end) &&
          s.start >= 0 &&
          s.end >= s.start,
      );
  }
  const api = {
    md5,
    wbiQuery,
    subtitleUrl,
    pickTrack,
    normalizeBody,
    decodeSubtitleTracks,
  };
  root.BiliSubtitles = api;
  if (typeof module === "object") module.exports = api;
})(globalThis);
