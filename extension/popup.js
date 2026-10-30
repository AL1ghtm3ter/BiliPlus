"use strict";
const $ = (s) => document.querySelector(s);
let config = BiliConfig.normalize();
const el = (tag, text, attrs = {}) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};
async function save() {
  config = BiliConfig.normalize(config);
  await chrome.storage.local.set({ biliSettings: config });
  render();
}
function toggle(key, title, hint = "") {
  const label = el("label", undefined, { class: "quick-toggle" }),
    input = el("input", undefined, {
      type: "checkbox",
      role: "switch",
      "aria-label": title,
    }),
    copy = el("span", undefined, { class: "toggle-copy" });
  input.checked = !!BiliConfig.get(config, key);
  input.addEventListener("change", async () => {
    try {
      BiliConfig.set(config, key, input.checked);
      await save();
    } catch (error) {
      $("#status").textContent = error.message;
    }
  });
  copy.append(el("strong", title));
  if (hint) copy.append(el("small", hint));
  label.append(copy, input);
  return label;
}
function render() {
  BiliUI.applyTheme(document, config);
  $("#version").textContent = "v" + chrome.runtime.getManifest().version;
  $("#theme").title =
    "外观：" +
    ({ system: "跟随系统", light: "浅色", dark: "深色" }[
      config.appearance.theme
    ] || "跟随系统");
  $("#quote").textContent = config.appearance.dailyQuoteEnabled
    ? BiliUI.dailyNote()
    : "";
  const all = BiliConfig.CATALOG.flatMap((group) => group.items).filter(
    (item) => item[0] !== "purify.hiddenElements",
  );
  $("#favorites").replaceChildren(
    ...config.appearance.favoriteFeatureIds
      .map((key) => all.find((item) => item[0] === key))
      .filter(Boolean)
      .map(([key, title]) => toggle(key, title)),
  );
  $("#groups").replaceChildren();
  for (const group of BiliConfig.CATALOG) {
    const details = el("details", undefined, { class: "feature-group" }),
      summary = el("summary"),
      meta = el("span", undefined, { class: "group-meta" }),
      chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg"),
      path = document.createElementNS("http://www.w3.org/2000/svg", "path"),
      list = el("div", undefined, { class: "feature-list" });
    chevron.setAttribute("viewBox", "0 0 12 12");
    chevron.setAttribute("width", "12");
    chevron.setAttribute("height", "12");
    chevron.setAttribute("class", "group-chevron");
    chevron.setAttribute("aria-hidden", "true");
    path.setAttribute("d", "m3 4 3 4 3-4");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.5");
    chevron.append(path);
    meta.append(el("span", String(group.items.length)), chevron);
    summary.append(el("span", group.title), meta);
    details.open = !config.appearance.popupGroupCollapseState.includes(
      group.group,
    );
    details.append(summary);
    for (const [key, title, hint] of group.items)
      if (key !== "purify.hiddenElements")
        list.append(toggle(key, title, hint));
      else {
        const button = el("button", title + " · 设置", {
          type: "button",
          class: "group-setting",
        });
        button.addEventListener("click", () =>
          chrome.runtime.openOptionsPage(),
        );
        list.append(button);
      }
    details.append(list);
    details.addEventListener("toggle", async () => {
      if (!details.isConnected) return;
      const state = new Set(config.appearance.popupGroupCollapseState),
        has = state.has(group.group);
      if (has === !details.open) return;
      details.open ? state.delete(group.group) : state.add(group.group);
      config.appearance.popupGroupCollapseState = [...state];
      try {
        await chrome.storage.local.set({
          biliSettings: BiliConfig.normalize(config),
        });
      } catch {}
    });
    $("#groups").append(details);
  }
}
$("#theme").addEventListener("click", async () => {
  const themes = ["system", "light", "dark"];
  config.appearance.theme =
    themes[(themes.indexOf(config.appearance.theme) + 1) % themes.length];
  try {
    await save();
  } catch (error) {
    $("#status").textContent = error.message;
  }
});
$("#settings").addEventListener("click", () =>
  chrome.runtime.openOptionsPage(),
);
(async () => {
  const data = await chrome.storage.local.get("biliSettings");
  config = BiliConfig.normalize(data.biliSettings);
  render();
})();
