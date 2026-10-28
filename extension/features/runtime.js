(function (root) {
  "use strict";
  const modules = [];
  class Scope {
    constructor() {
      this.disposers = [];
    }
    on(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      this.disposers.push(() =>
        target.removeEventListener(type, handler, options),
      );
      return handler;
    }
    interval(fn, delay) {
      const id = setInterval(fn, delay);
      this.disposers.push(() => clearInterval(id));
      return id;
    }
    node(node, parent = document.documentElement) {
      parent.append(node);
      this.disposers.push(() => node.remove());
      return node;
    }
    move(node, parent) {
      if (!node) return;
      if (!node.parentNode) {
        parent.append(node);
        this.disposers.push(() => node.remove());
        return;
      }
      const placeholder = document.createComment(
        "bili-codex-original-location",
      );
      node.before(placeholder);
      parent.append(node);
      this.disposers.push(() => {
        if (placeholder.isConnected) {
          if (parent.contains(node)) placeholder.replaceWith(node);
          else placeholder.remove();
        }
      });
    }
    clean() {
      for (const dispose of this.disposers.reverse())
        try {
          dispose();
        } catch {}
      this.disposers = [];
    }
  }
  function create(tag, text, attributes = {}) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    for (const [key, value] of Object.entries(attributes))
      node.setAttribute(key, value);
    return node;
  }
  function widget(name, css) {
    const host = create("div", undefined, { "data-bcx-widget": name }),
      shadow = host.attachShadow({ mode: "open" }),
      style = create("style");
    style.textContent =
      ':host{font:13px/1.6 "Microsoft YaHei UI",sans-serif;color:#27212a}:host([hidden]){display:none!important}*{box-sizing:border-box}[hidden]{display:none!important}button,input,textarea{font:inherit}button{cursor:pointer;border:1px solid #d8c8d0;border-radius:7px;padding:5px 9px;background:#fff;color:#9c2854}button:hover{background:#fff0f5}button:focus-visible,input:focus-visible{outline:3px solid #a52c5a;outline-offset:2px}button:disabled{opacity:.5;cursor:default}' +
      css;
    shadow.append(style);
    const settings = root.BiliFeatures?.context?.settings?.();
    if (settings) {
      host.setAttribute("data-theme", root.BiliConfig.theme(settings));
      style.textContent +=
        ':host([data-theme="dark"]){color:#eee6eb;background-color:#242027;color-scheme:dark}:host([data-theme="dark"]) button{background:#2e2730;border-color:#66515f;color:#f0b7cd}:host([data-theme="dark"]) .bar,:host([data-theme="dark"]) .search,:host([data-theme="dark"]) .copy{background:#242027}:host([data-theme="dark"]) p{color:#bdb0ba}';
    }
    return { host, shadow };
  }
  const bvidFrom = (value) =>
    String(value || "").match(/(?:\/video\/)?(BV[0-9A-Za-z]{10})/)?.[1] || "";
  function count(value) {
    const s = String(value || "")
      .replace(/,/g, "")
      .trim();
    const n = Number.parseFloat(s);
    return Number.isFinite(n)
      ? n * (s.includes("亿") ? 1e8 : s.includes("万") ? 1e4 : 1)
      : undefined;
  }
  function duration(value) {
    const s = String(value || "").trim();
    if (/^\d+(?::\d+){1,2}$/.test(s))
      return s.split(":").reduce((n, v) => n * 60 + Number(v), 0);
    return undefined;
  }
  const CARD =
    ".bili-video-card,.video-page-card-small,.bili-video-card__wrap,.video-list-item";
  const api = {
    modules,
    Scope,
    create,
    widget,
    bvidFrom,
    count,
    duration,
    CARD,
    register: (name, start) => modules.push({ name, start }),
  };
  root.BiliFeatures = api;
  if (typeof module === "object") module.exports = api;
})(globalThis);
