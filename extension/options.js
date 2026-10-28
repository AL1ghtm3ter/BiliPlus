"use strict";
const C = BiliConfig,
  $ = (s) => document.querySelector(s);
let config = C.normalize(),
  saved = "",
  localBackground = null,
  backgroundChanged = false,
  modelSetup = null,
  modelSetupSequence = 0,
  modelCheckSequence = 0;
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
  updateModelControls();
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
  if (type === "textarea")
    input.maxLength = key === "ai.summaryPrompt" ? 10000 : 100000;
  for (const [value, label] of choices) {
    const option = el("option", label, { value });
    input.append(option);
  }
  input.addEventListener(type === "checkbox" ? "change" : "input", () => {
    if (modelSetup && ["ai.provider", "ai.localModel"].includes(key)) {
      populate();
      return;
    }
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
    if (["ai.provider", "ai.localModel"].includes(key)) {
      modelCheckSequence++;
      const status = $("#model-setup-status");
      if (status) status.textContent = "模型选择已变更，请检查或准备所选模型。";
    }
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
  if (!valid.includes(name)) name = "ai";
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
function modelConnectionText(result, provider, model) {
  if (!result?.ok) return result?.error || "连接失败，请重试。";
  if (result.provider && result.provider !== provider)
    return "返回的服务与当前选择不同，请重新检查；不会自动切换服务。";
  let text;
  if (provider === "codex") {
    text = "Codex 桥接已连接，请确保本机 Codex 已登录并有可用额度。";
  } else if (
    result.localRuntimeReady === true &&
    result.localModelReady === true &&
    result.localModel === model
  ) {
    text = "本机模型 " + model + " 已就绪，无需账号。";
  } else if (result.localRuntimeReady === false) {
    text = "本机运行环境尚未准备，点击“下载并配置本地模型”开始。";
  } else if (
    result.localRuntimeReady === true &&
    result.localModelReady === false
  ) {
    text = "本机运行环境可用，所选模型尚未准备，请下载并配置。";
  } else {
    text = "桥接已连接；所选本机模型的状态尚未确认，请重新检查。";
  }
  return (
    text +
    (result.asrReady === true
      ? " 本机转写已就绪。"
      : result.asrReady === false
        ? " 本机转写尚未安装。"
        : " 本机转写状态尚未确认。")
  );
}
function updateModelControls() {
  const local = config.ai.provider === "local",
    controls = $("#model-setup-controls"),
    note = $("#model-provider-note");
  if (controls) controls.hidden = !local;
  const model = $('[data-key="ai.localModel"]'),
    provider = $('[data-key="ai.provider"]');
  if (model) {
    model.closest(".field").hidden = !local;
    model.disabled = !!modelSetup;
  }
  if (provider) provider.disabled = !!modelSetup;
  if (note)
    note.textContent = local
      ? "默认使用本机模型，内容在这台电脑上处理，无需注册或登录。Qwen3 4B 首次约需下载 2.5GB；自动处理默认关闭。"
      : "使用本机已登录的 Codex，内容将交给对应模型服务处理，需要账号及可用额度。不会自动从本机模型切换到 Codex。";
  for (const id of ["model-setup-start", "model-setup-check"])
    if ($("#" + id)) $("#" + id).disabled = !!modelSetup;
  if ($("#model-setup-cancel"))
    $("#model-setup-cancel").disabled = !modelSetup || !!modelSetup.done;
}
function finishModelSetup(active, message, error = false) {
  if (modelSetup !== active) return;
  active.done = true;
  modelSetup = null;
  try {
    active.port?.disconnect();
  } catch {}
  const status = $("#model-setup-status");
  status.textContent = message;
  status.classList.toggle("error", error);
  $("#model-setup-progress").hidden = true;
  updateModelControls();
}
function cancelModelSetup(message = "已取消准备，模型服务没有切换。") {
  const active = modelSetup;
  if (!active || active.done) return;
  try {
    active.port.postMessage({ type: "cancel", id: active.id });
  } catch {}
  finishModelSetup(active, message);
}
async function savePreparedModel(model) {
  const stored = await chrome.storage.local.get("biliSettings"),
    next = C.normalize(stored.biliSettings);
  next.ai.provider = "local";
  next.ai.localModel = model;
  await chrome.storage.local.set({ biliSettings: next });
  config.ai.provider = "local";
  config.ai.localModel = model;
  const savedConfig = C.normalize(JSON.parse(saved || "{}"));
  savedConfig.ai.provider = "local";
  savedConfig.ai.localModel = model;
  saved = JSON.stringify(savedConfig);
}
async function checkModel() {
  if (modelSetup) return;
  const sequence = ++modelCheckSequence,
    provider = config.ai.provider,
    model = config.ai.localModel,
    button = $("#model-setup-check");
  button.disabled = true;
  $("#model-setup-status").textContent = "正在检查本机模型…";
  $("#model-setup-status").classList.remove("error");
  try {
    const result = await chrome.runtime.sendMessage({
      type: "check",
      provider,
      model,
    });
    if (sequence !== modelCheckSequence || modelSetup) return;
    $("#model-setup-status").textContent = modelConnectionText(
      result,
      provider,
      model,
    );
  } catch (error) {
    if (sequence === modelCheckSequence && !modelSetup)
      $("#model-setup-status").textContent =
        error.message || "模型状态检查失败，请重试。";
  } finally {
    if (!modelSetup) button.disabled = false;
  }
}
function startModelSetup() {
  if (modelSetup || config.ai.provider !== "local") return;
  const model = C.normalize({
      ai: { provider: "local", localModel: config.ai.localModel },
    }).ai.localModel,
    id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : Date.now().toString(36) +
          "-" +
          Math.random().toString(36).slice(2) +
          "-" +
          ++modelSetupSequence,
    active = { id, model, port: null, done: false };
  modelSetup = active;
  modelCheckSequence++;
  $("#model-setup-status").textContent =
    "正在连接本机，准备下载并配置 " + model + "…";
  $("#model-setup-status").classList.remove("error");
  const progress = $("#model-setup-progress");
  progress.hidden = false;
  progress.removeAttribute("value");
  updateModelControls();
  try {
    active.port = chrome.runtime.connect({ name: "bili-model-setup" });
    active.port.onMessage.addListener(async (packet) => {
      if (modelSetup !== active || active.done) return;
      if (!packet || typeof packet !== "object") {
        finishModelSetup(active, "收到无效的模型准备信息，请重试。", true);
        return;
      }
      if (packet.id !== undefined && packet.id !== active.id) return;
      if (packet.type === "progress") {
        let percent = packet.percent;
        if (
          percent === undefined &&
          Number.isFinite(packet.completed) &&
          Number.isFinite(packet.total) &&
          packet.total > 0
        )
          percent = (packet.completed / packet.total) * 100;
        if (
          percent !== undefined &&
          (!Number.isFinite(percent) || percent < 0 || percent > 100)
        ) {
          finishModelSetup(active, "模型准备进度无效，请重试。", true);
          return;
        }
        const status =
            typeof packet.status === "string"
              ? packet.status.slice(0, 200)
              : "",
          stage =
            typeof packet.stage === "string" ? packet.stage.slice(0, 80) : "";
        if (!status && !stage && percent === undefined) {
          finishModelSetup(active, "收到无效的模型准备进度，请重试。", true);
          return;
        }
        if (percent === undefined) progress.removeAttribute("value");
        else progress.value = percent;
        $("#model-setup-status").textContent =
          (status || stage || "正在准备模型") +
          (percent === undefined ? "" : " · " + Math.round(percent) + "%");
      } else if (packet.type === "result") {
        if (
          packet.result?.ready !== true ||
          packet.result.model !== active.model
        ) {
          finishModelSetup(
            active,
            "所选模型尚未确认准备完成，请检查后重试。",
            true,
          );
          return;
        }
        active.done = true;
        updateModelControls();
        try {
          await savePreparedModel(active.model);
          if (modelSetup !== active) return;
          finishModelSetup(
            active,
            "本机模型 " + active.model + " 已就绪并已配置，无需账号。",
          );
          notice(
            dirty()
              ? "模型已配置；其他修改仍需点击保存设置。"
              : "本机模型已准备并保存。",
          );
        } catch (error) {
          finishModelSetup(
            active,
            "模型已准备，但配置保存失败：" +
              (error.message || "请点击保存设置重试。"),
            true,
          );
        }
      } else if (packet.type === "error") {
        finishModelSetup(
          active,
          typeof packet.error === "string"
            ? packet.error
            : "模型准备失败，请重试。",
          true,
        );
      } else {
        finishModelSetup(
          active,
          "模型准备协议不兼容，请重新加载扩展后重试。",
          true,
        );
      }
    });
    active.port.onDisconnect.addListener(() => {
      if (modelSetup === active && !active.done)
        finishModelSetup(
          active,
          "本机连接已断开，模型准备尚未确认完成，请重试。",
          true,
        );
    });
    active.port.postMessage({ type: "setup-local-model", model, id });
  } catch (error) {
    finishModelSetup(
      active,
      "无法开始模型准备：" + (error.message || "请重试。"),
      true,
    );
  }
}
function modelControls(page) {
  const section = el("div", undefined, { id: "model-setup-controls" }),
    buttons = el("div", undefined, { class: "button-row" }),
    start = el("button", "下载并配置本地模型", {
      type: "button",
      id: "model-setup-start",
    }),
    check = el("button", "检查模型状态", {
      type: "button",
      id: "model-setup-check",
    }),
    cancel = el("button", "取消准备", {
      type: "button",
      id: "model-setup-cancel",
      disabled: "disabled",
    }),
    progress = el("progress", undefined, {
      id: "model-setup-progress",
      max: "100",
      "aria-label": "模型准备进度",
      hidden: "hidden",
    });
  buttons.append(start, check, cancel);
  section.append(
    buttons,
    progress,
    el("p", "尚未检查本机模型。", {
      id: "model-setup-status",
      role: "status",
      "aria-live": "polite",
    }),
  );
  start.addEventListener("click", startModelSetup);
  check.addEventListener("click", () => void checkModel());
  cancel.addEventListener("click", () => cancelModelSetup());
  page.append(section);
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
  updateModelControls();
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
    if (group.group === "ai")
      page.append(
        el("p", "", { class: "section-note", id: "model-provider-note" }),
      );
    for (const spec of BiliSettingsFields[group.group] || []) field(page, spec);
    if (group.group === "ai") modelControls(page);
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
    cancelModelSetup("配置已更改，已取消原模型的准备。");
    modelCheckSequence++;
    config = nextConfig;
    localBackground = nextBackground;
    $("#model-setup-status").textContent =
      "配置已更改，请重新检查或准备所选模型。";
    $("#model-setup-status").classList.remove("error");
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
  cancelModelSetup("已恢复默认配置，模型准备已取消。");
  modelCheckSequence++;
  config = C.normalize();
  localBackground = null;
  $("#model-setup-status").textContent = "配置已恢复默认，请重新检查本机模型。";
  $("#model-setup-status").classList.remove("error");
  backgroundChanged = true;
  populate();
  changed();
  notice("已恢复默认值，保存后生效。");
});
$("#clear-cache").addEventListener("click", async () => {
  const data = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(
    Object.keys(data).filter((key) => /^(summary:|ai:|transcript:)/.test(key)),
  );
  notice("已清除 AI 和字幕缓存，配置与背景仍保留。");
});
$("#check").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  $("#connection").textContent = "正在检查…";
  try {
    const provider = config.ai.provider,
      model = config.ai.localModel,
      result = await chrome.runtime.sendMessage({
        type: "check",
        provider,
        model,
      });
    $("#connection").textContent = modelConnectionText(result, provider, model);
  } catch (error) {
    $("#connection").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
window.addEventListener("beforeunload", (event) => {
  if (dirty()) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("pagehide", () => cancelModelSetup());
(async () => {
  const stored = await chrome.storage.local.get([
    "biliSettings",
    "localBackground",
    "diagnostics",
  ]);
  config = C.normalize(stored.biliSettings);
  if (stored.localBackground)
    try {
      localBackground = BiliUI.validateBackground(stored.localBackground);
    } catch {}
  saved = JSON.stringify(config);
  render();
  const log = $("#diagnostics");
  for (const item of (stored.diagnostics || []).slice(-20).reverse())
    log.append(
      el(
        "div",
        new Date(item.at).toLocaleString() +
          " · " +
          item.kind +
          " · " +
          item.status +
          (item.error ? " · " + item.error : "") +
          (item.elapsedMs
            ? " · " + (item.elapsedMs / 1000).toFixed(1) + "秒"
            : ""),
        { class: "diagnostic" },
      ),
    );
  if (!log.children.length) log.textContent = "尚无诊断记录。";
})();
