"use strict";
const C = BiliConfig,
  $ = (s) => document.querySelector(s);
let config = C.normalize(),
  saved = "",
  localBackground = null,
  backgroundChanged = false;
const el = (tag, text, attributes = {}) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  for (const [key, value] of Object.entries(attributes))
    node.setAttribute(key, value);
  return node;
};
function notice(text, error = false) {
  $("#status").textContent = text;
  $("#status").classList.toggle("error", error);
}
function dirty() {
  return saved !== JSON.stringify(config) || backgroundChanged;
}
function changed() {
  BiliUI.applyTheme(document, config);
  notice(dirty() ? "有未保存的修改。" : "配置已保存。");
}
function field(page, spec) {
  const {
      key,
      label,
      type,
      min,
      max,
      step = 1,
      list,
      hint,
      choices = [],
    } = spec,
    wrap = el("label", undefined, { class: "field" }),
    input = el(
      type === "textarea" ? "textarea" : type === "select" ? "select" : "input",
      undefined,
      { "data-key": key },
    );
  if (input.tagName === "INPUT") input.type = type;
  if (min !== undefined) input.min = min;
  if (max !== undefined) input.max = max;
  if (type === "number") input.step = step;
  if (type === "textarea") input.maxLength = 100000;
  for (const [value, label] of choices) {
    const option = el("option", label, { value });
    input.append(option);
  }
  input.addEventListener(type === "checkbox" ? "change" : "input", () => {
    let value =
      type === "checkbox"
        ? input.checked
        : type === "number"
          ? Number(input.value)
          : input.value;
    if (list)
      value = input.value
        .split(/[\n,，]/)
        .map((x) => x.trim())
        .filter(Boolean);
    C.set(config, key, value);
    changed();
  });
  const copy = el("span", undefined, { class: "field-copy" });
  copy.append(el("strong", label));
  if (hint) copy.append(el("small", hint));
  wrap.append(copy, input);
  page.append(wrap);
}
function activate(name) {
  const valid = [...C.CATALOG.map((g) => g.group), "appearance", "backup"];
  if (!valid.includes(name)) name = "player";
  for (const page of document.querySelectorAll(".page"))
    page.hidden = page.id !== "page-" + name;
  for (const button of $("#nav").children)
    button.setAttribute("aria-selected", String(button.dataset.page === name));
  location.hash = name;
}
function navigation(id, title) {
  const button = el("button", undefined, { type: "button", "data-page": id });
  button.append(el("span", title));
  button.addEventListener("click", () => activate(id));
  $("#nav").append(button);
}
function feature(page, key, title, description) {
  const row = el("div", undefined, { class: "setting-row" }),
    label = el("label"),
    input = el("input", undefined, {
      type: "checkbox",
      "data-key": key,
      role: "switch",
    }),
    copy = el("span");
  copy.append(el("strong", title), el("small", description));
  input.addEventListener("change", () => {
    C.set(config, key, input.checked);
    changed();
  });
  label.append(copy, input);
  const favorite = el("button", undefined, {
    type: "button",
    "data-favorite": key,
  });
  favorite.addEventListener("click", () => {
    const keys = new Set(config.appearance.favoriteFeatureIds);
    keys.has(key) ? keys.delete(key) : keys.add(key);
    config.appearance.favoriteFeatureIds = [...keys];
    populate();
    changed();
  });
  row.append(label, favorite);
  page.append(row);
}
function backgroundControls(page) {
  const row = el("div", undefined, { class: "button-row" }),
    upload = el("label", "选择本地背景", { class: "file-button" }),
    input = el("input", undefined, {
      type: "file",
      accept: "image/png,image/jpeg,image/webp",
    });
  input.addEventListener("change", async () => {
    try {
      localBackground = await BiliUI.prepareImage(input.files?.[0]);
      backgroundChanged = true;
      config.home.backgroundSource = "local";
      populate();
      changed();
      notice("本地图片已处理，保存后生效。");
    } catch (error) {
      notice(error.message, true);
    } finally {
      input.value = "";
    }
  });
  upload.append(input);
  const reset = el("button", "恢复默认背景", { type: "button" });
  reset.addEventListener("click", () => {
    localBackground = null;
    backgroundChanged = true;
    config.home.backgroundSource = "url";
    config.home.backgroundUrl = "";
    populate();
    changed();
  });
  row.append(upload, reset);
  page.append(row, el("p", "", { class: "background-info" }));
}
function populate() {
  BiliUI.applyTheme(document, config);
  for (const input of document.querySelectorAll("[data-key]")) {
    const value = C.get(config, input.dataset.key);
    if (input.type === "checkbox") input.checked = !!value;
    else
      input.value = Array.isArray(value)
        ? value.join(input.tagName === "TEXTAREA" ? "\n" : ", ")
        : value;
  }
  for (const input of document.querySelectorAll("[data-hidden-rule]"))
    input.checked = config.purify.hiddenElements.includes(
      input.dataset.hiddenRule,
    );
  for (const button of document.querySelectorAll("[data-favorite]")) {
    const active = config.appearance.favoriteFeatureIds.includes(
      button.dataset.favorite,
    );
    button.setAttribute("aria-pressed", String(active));
    button.setAttribute("aria-label", active ? "取消固定到弹窗" : "固定到弹窗");
    button.title = active ? "取消固定到弹窗" : "固定到弹窗";
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg"),
      outline = document.createElementNS("http://www.w3.org/2000/svg", "path");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    outline.setAttribute("d", "m9 3 9 9-3 1-3 4-2-2-6 6-1-1 6-6-2-2 4-3Z");
    icon.append(outline);
    button.replaceChildren(icon);
  }
  const background = $(".background-info");
  if (background)
    background.textContent = localBackground
      ? "本地图片：" +
        localBackground.name +
        " · " +
        localBackground.width +
        "×" +
        localBackground.height
      : "尚未选择本地背景图片。";
}
function render() {
  $("#version").textContent = chrome.runtime.getManifest().version;
  for (const group of [
    ...C.CATALOG,
    { group: "appearance", title: "界面与弹窗", items: [] },
  ]) {
    navigation(group.group, group.title);
    const page = el("section", undefined, {
      id: "page-" + group.group,
      class: "page",
    });
    page.append(el("h2", group.title));
    for (const [key, title, hint] of group.items)
      if (key !== "purify.hiddenElements") feature(page, key, title, hint);
    for (const spec of BiliSettingsFields[group.group] || []) field(page, spec);
    if (group.group === "purify") {
      const list = el("div", undefined, { class: "hidden-rules" });
      for (const [key, rule] of Object.entries(C.HIDDEN)) {
        const label = el("label"),
          input = el("input", undefined, {
            type: "checkbox",
            "data-hidden-rule": key,
          });
        input.addEventListener("change", () => {
          const keys = new Set(config.purify.hiddenElements);
          input.checked ? keys.add(key) : keys.delete(key);
          config.purify.hiddenElements = [...keys];
          changed();
        });
        label.append(input, document.createTextNode(rule.label));
        list.append(label);
      }
      page.append(el("h3", "自选隐藏元素"), list);
    }
    if (group.group === "layout") backgroundControls(page);
    if (group.group === "appearance")
      page.append(
        el(
          "p",
          "功能行右侧可把常用开关固定到弹窗顶部。各分组的折叠状态会自动记住。",
        ),
      );
    if (group.group === "filter")
      page.append(
        el(
          "p",
          "规则仅在本地隐藏卡片，不执行账号拉黑或“不感兴趣”。连续多批全部命中时会暂停规则过滤。",
          { class: "section-note" },
        ),
      );
    $("#pages").append(page);
  }
  navigation("backup", "备份与维护");
  populate();
  activate(location.hash.slice(1));
}
function download(name, value) {
  const link = el("a", undefined, {
    href: URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    ),
    download: name,
  });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
$("#appearance").addEventListener("click", () => activate("appearance"));
$("#save").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    config = C.normalize(config);
    if (localBackground)
      localBackground = BiliUI.validateBackground(localBackground);
    const updates = {
      biliSettings: config,
      ...(backgroundChanged && localBackground ? { localBackground } : {}),
    };
    try {
      await chrome.storage.local.set(updates);
    } catch (error) {
      if (!/quota/i.test(error.message || "")) throw error;
      const stored = await chrome.storage.local.get(null);
      const keys = Object.keys(stored).filter((key) =>
        /^(summary:|ai:|transcript:)/.test(key),
      );
      if (!keys.length) throw error;
      await chrome.storage.local.remove(keys);
      await chrome.storage.local.set(updates);
    }
    if (backgroundChanged && !localBackground)
      await chrome.storage.local.remove("localBackground");
    saved = JSON.stringify(config);
    backgroundChanged = false;
    populate();
    notice("已保存，打开的 B站页面会自动应用。");
  } catch (error) {
    notice(error.message, true);
  } finally {
    button.disabled = false;
  }
});
$("#export").addEventListener("click", () => {
  try {
    download(
      "biliplus-settings-" + new Date().toISOString().slice(0, 10) + ".json",
      { ...C.backup(config), ...(localBackground ? { localBackground } : {}) },
    );
    notice("配置已导出，本地图片如已选择也会包含在备份中。");
  } catch (error) {
    notice(error.message, true);
  }
});
$("#import").addEventListener("change", async (event) => {
  const input = event.currentTarget;
  try {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) throw Error("配置备份超过 5MB。");
    const backup = JSON.parse(await file.text());
    const nextConfig = C.restore(backup),
      nextBackground = backup.localBackground
        ? BiliUI.validateBackground(backup.localBackground)
        : null;
    config = nextConfig;
    localBackground = nextBackground;
    backgroundChanged = true;
    populate();
    changed();
    notice("已读取配置备份，保存后生效。");
  } catch (error) {
    notice(error.message, true);
  } finally {
    input.value = "";
  }
});
$("#reset").addEventListener("click", () => {
  config = C.normalize();
  localBackground = null;
  backgroundChanged = true;
  populate();
  changed();
  notice("已恢复默认值，保存后生效。");
});
window.addEventListener("beforeunload", (event) => {
  if (dirty()) {
    event.preventDefault();
    event.returnValue = "";
  }
});
(async () => {
  const stored = await chrome.storage.local.get([
    "biliSettings",
    "localBackground",
  ]);
  config = C.normalize(stored.biliSettings);
  if (stored.localBackground)
    try {
      localBackground = BiliUI.validateBackground(stored.localBackground);
    } catch {}
  saved = JSON.stringify(config);
  render();
})();
