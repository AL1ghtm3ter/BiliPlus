"use strict";
importScripts("common/config.js");

function biliSender(sender) {
  try {
    const url = new URL(sender.url);
    return (
      sender.id === chrome.runtime.id &&
      url.protocol === "https:" &&
      ["www.bilibili.com", "search.bilibili.com"].includes(url.hostname) &&
      sender.frameId === 0
    );
  } catch {
    return false;
  }
}

// Remove only retired assistant data; retain settings for playback and browsing.
chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(null);
  const retired = Object.keys(stored).filter(
    (key) =>
      /^(summary:|ai:|transcript:)/.test(key) ||
      [
        "lastSummary",
        "diagnostics",
        "biliStats",
        "assistantPanelHeight",
      ].includes(key),
  );
  if (retired.length) await chrome.storage.local.remove(retired);
  await chrome.storage.local.set({
    biliSettings: BiliConfig.normalize(stored.biliSettings),
  });
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!biliSender(sender)) return;
  if (message?.type === "open-settings") {
    chrome.runtime
      .openOptionsPage()
      .then(() => respond({ ok: true }))
      .catch(() => respond({ ok: false }));
    return true;
  }
  if (
    message?.type === "bili-api" &&
    /^BV[0-9A-Za-z]{10}$/.test(message.bvid || "") &&
    ["view", "videoshot"].includes(message.task)
  ) {
    const path =
      message.task === "view" ? "/x/web-interface/view" : "/x/player/videoshot";
    fetch(
      "https://api.bilibili.com" +
        path +
        "?bvid=" +
        message.bvid +
        (message.task === "videoshot" ? "&index=1" : ""),
      {
        credentials: "include",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    )
      .then(async (response) => {
        if (!response.ok)
          throw Error("B站数据请求失败（" + response.status + "）。");
        const data = await response.json();
        if (data.code !== 0) throw Error("B站没有返回预览信息。");
        respond({ ok: true, data: data.data });
      })
      .catch((error) => respond({ ok: false, error: error.message }));
    return true;
  }
});
