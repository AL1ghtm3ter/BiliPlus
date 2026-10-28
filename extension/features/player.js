(() => {
  "use strict";
  const F = BiliFeatures;
  F.register("player", (settings, context) => {
    const s = settings.player,
      // index.patch mutates settings before stopping the previous instance.
      speedEnabled = s.speedEnabled,
      scope = new F.Scope();
    const ipBadges = new Set();
    if (!speedEnabled && !s.fullscreenProgress && !s.commentIp) return () => {};
    let video = null,
      originalRate = 1,
      originalDefaultRate = 1,
      targetRate = s.speed,
      applyingRate = false,
      holdingRight = false,
      restoreTimer,
      speedHost,
      speedMenu,
      range,
      progress,
      progressRange,
      rateListener,
      timeListener;
    const nativeResults = new Map(),
      resultBackup = "data-bcx-original-rate-result";
    function restoreMenu() {
      speedMenu?.removeAttribute("data-bcx-speed-menu");
      speedMenu = null;
      for (const [node, text] of nativeResults) {
        node.textContent = text;
        node.removeAttribute(resultBackup);
      }
      nativeResults.clear();
    }
    const playerRoot = () =>
      video?.closest("#playerWrap") ||
      video?.closest("#bilibili-player") ||
      video?.parentElement;
    const showRate = () => {
      if (!video) return;
      if (range && Number(range.value) !== targetRate) range.value = targetRate;
      const root = playerRoot();
      if (!speedMenu || !root) return;
      for (const node of root.querySelectorAll(
        ".bpx-player-ctrl-playbackrate-result",
      )) {
        if (!nativeResults.has(node)) {
          const original = node.getAttribute(resultBackup) ?? node.textContent;
          nativeResults.set(node, original);
          node.setAttribute(resultBackup, original);
        }
        const text = targetRate === 1 ? "倍速" : targetRate + "x";
        if (node.textContent !== text) node.textContent = text;
      }
      for (const button of speedHost?.querySelectorAll(
        "[data-bcx-speed-option]",
      ) || []) {
        const active =
          Number(button.getAttribute("data-bcx-speed-option")) === targetRate;
        for (const attribute of ["data-active", "aria-pressed"])
          if (button.getAttribute(attribute) !== String(active))
            button.setAttribute(attribute, String(active));
      }
    };
    const applyRate = () => {
      if (!video || !speedEnabled || holdingRight || applyingRate) return;
      applyingRate = true;
      try {
        if (video.defaultPlaybackRate !== targetRate)
          video.defaultPlaybackRate = targetRate;
        if (video.playbackRate !== targetRate) video.playbackRate = targetRate;
      } finally {
        applyingRate = false;
      }
      showRate();
    };
    const setRate = (value) => {
      if (!video) return;
      const rate = Math.max(0.1, Math.min(5, Math.round(value * 100) / 100));
      targetRate = rate;
      applyRate();
      context.patch("player.speed", rate);
    };
    function controls() {
      if (!video) return;
      const menu = speedEnabled
        ? playerRoot()?.querySelector(".bpx-player-ctrl-playbackrate-menu") ||
          null
        : null;
      if (menu !== speedMenu) {
        restoreMenu();
        speedMenu = menu;
        speedMenu?.setAttribute("data-bcx-speed-menu", "1");
      }
      if (menu && !speedHost) {
        const style = F.create("style", undefined, {
          "data-bcx-speed-style": "1",
        });
        style.textContent = `
.bpx-player-ctrl-playbackrate-menu[data-bcx-speed-menu] {
  width:104px!important;min-width:104px!important;padding:4px 0!important;overflow:hidden!important;
}
.bpx-player-ctrl-playbackrate-menu[data-bcx-speed-menu]>.bpx-player-ctrl-playbackrate-menu-item {display:none!important}
[data-bcx-widget="speed"] {
  display:flex!important;align-items:center!important;justify-content:center!important;gap:10px!important;
  width:104px!important;height:var(--bcx-rate-menu-height,180px)!important;
  padding:0!important;margin:0!important;cursor:default!important;
}
[data-bcx-widget="speed"] input[type="range"] {
  display:block!important;width:14px!important;height:calc(var(--bcx-rate-menu-height,180px) - 16px)!important;
  margin:8px 0!important;writing-mode:vertical-lr!important;direction:rtl!important;
  appearance:none;-webkit-appearance:none;background:transparent;cursor:pointer;
}
[data-bcx-widget="speed"] input[type="range"]::-webkit-slider-runnable-track {
  width:3px;height:100%;border-radius:2px;background:rgba(255,255,255,.38);
}
[data-bcx-widget="speed"] input[type="range"]::-webkit-slider-thumb {
  width:10px;height:10px;margin-left:-3.5px;border:0;border-radius:50%;appearance:none;
  -webkit-appearance:none;background:#00aeec;box-shadow:0 0 0 2px rgba(0,0,0,.18);
}
[data-bcx-widget="speed"] input[type="range"]::-moz-range-track {
  width:3px;border-radius:2px;background:rgba(255,255,255,.38);
}
[data-bcx-widget="speed"] input[type="range"]::-moz-range-thumb {
  width:10px;height:10px;border:0;border-radius:50%;background:#00aeec;
}
[data-bcx-widget="speed"] [data-bcx-speed-options] {
  display:flex;flex-direction:column;gap:2px;width:46px;
}
[data-bcx-widget="speed"] [data-bcx-speed-option] {
  height:24px;border:0;border-radius:3px;padding:0;background:transparent;color:rgba(255,255,255,.78);
  font:inherit;font-size:14px;line-height:24px;cursor:pointer;
}
[data-bcx-widget="speed"] [data-bcx-speed-option]:hover,
[data-bcx-widget="speed"] [data-bcx-speed-option][data-active="true"] {
  background:rgba(255,255,255,.12);color:#00aeec;
}
[data-bcx-widget="speed"] :focus-visible {outline:2px solid #00aeec;outline-offset:2px}
`;
        scope.node(style, document.head);
        speedHost = F.create("li", undefined, { "data-bcx-widget": "speed" });
        speedHost.style.setProperty(
          "--bcx-rate-menu-height",
          Math.max(180, s.presets.length * 26 + 16) + "px",
        );
        range = F.create("input", undefined, {
          type: "range",
          min: "0.1",
          max: "5",
          step: "0.01",
          "aria-label": "无级倍速",
        });
        const options = F.create("div", undefined, {
          "data-bcx-speed-options": "1",
        });
        for (const rate of s.presets) {
          const button = F.create("button", rate + "x", {
            type: "button",
            "data-bcx-speed-option": rate,
            "aria-pressed": "false",
          });
          button.addEventListener("click", (event) => {
            event.preventDefault();
            setRate(rate);
          });
          options.append(button);
        }
        speedHost.addEventListener("click", (event) => event.stopPropagation());
        range.addEventListener("input", () => setRate(Number(range.value)));
        speedHost.append(range, options);
        scope.disposers.push(() => speedHost?.remove());
      }
      if (speedHost) {
        if (!menu) speedHost.remove();
        else if (speedHost.parentNode !== menu) menu.append(speedHost);
        showRate();
      }
      if (s.fullscreenProgress && !progress) {
        const w = F.widget(
          "fullscreen-progress",
          ":host{position:absolute;left:0;right:0;bottom:0;z-index:99999;height:8px;display:block}input{display:block;width:100%;height:8px;margin:0;accent-color:#e35b8f;cursor:pointer}",
        );
        progress = w.host;
        progressRange = F.create("input", undefined, {
          type: "range",
          min: 0,
          max: video.duration || 1,
          step: ".1",
          "aria-label": "全屏播放进度",
        });
        progressRange.addEventListener("input", () => {
          video.currentTime = Number(progressRange.value);
        });
        w.shadow.append(progressRange);
        scope.disposers.push(() => progress?.remove());
      }
    }
    function updateFullscreen() {
      if (!progress) return;
      syncProgress();
      const target = document.fullscreenElement;
      if (target && video && target.contains(video)) {
        if (progress.parentNode !== target) target.append(progress);
        progress.hidden = false;
      } else progress.hidden = true;
    }
    function syncProgress() {
      if (!progressRange || !video) return;
      const duration =
        Number.isFinite(video.duration) && video.duration > 0
          ? video.duration
          : 1;
      progressRange.max = duration;
      progressRange.value = Math.max(
        0,
        Math.min(duration, Number(video.currentTime) || 0),
      );
    }
    function detachVideo() {
      if (!video) return;
      video.removeEventListener("ratechange", rateListener);
      video.removeEventListener("timeupdate", timeListener);
      for (const event of ["loadedmetadata", "durationchange"])
        video.removeEventListener(event, syncProgress);
      for (const event of ["loadedmetadata", "canplay", "play"])
        video.removeEventListener(event, applyRate);
      if (speedEnabled) {
        video.defaultPlaybackRate = originalDefaultRate;
        video.playbackRate = originalRate;
      }
    }
    function scan() {
      const player =
        document.querySelector("#playerWrap") ||
        document.querySelector("#bilibili-player");
      const next = player
        ? player.querySelector("video")
        : document.querySelector("video");
      if (next !== video) {
        detachVideo();
        video = next;
        if (!video) {
          restoreMenu();
          speedHost?.remove();
          progress?.remove();
          return;
        }
        originalRate = video.playbackRate;
        originalDefaultRate = video.defaultPlaybackRate;
        rateListener = () => {
          applyRate();
          showRate();
        };
        timeListener = syncProgress;
        video.addEventListener("ratechange", rateListener);
        video.addEventListener("timeupdate", timeListener);
        for (const event of ["loadedmetadata", "durationchange"])
          video.addEventListener(event, syncProgress);
        if (speedEnabled)
          for (const event of ["loadedmetadata", "canplay", "play"])
            video.addEventListener(event, applyRate);
        applyRate();
      }
      controls();
      updateFullscreen();
      if (s.commentIp) commentIps();
    }
    function commentIps() {
      for (const badge of ipBadges)
        if (!badge.isConnected) ipBadges.delete(badge);
      const roots = [
          ...document.querySelectorAll(
            "#commentapp,.comment-container,bili-comments",
          ),
        ],
        visited = new Set();
      let checked = 0;
      while (roots.length && checked++ < 10000) {
        const root = roots.shift();
        if (visited.has(root)) continue;
        visited.add(root);
        if (root.shadowRoot) roots.push(root.shadowRoot);
        for (const node of root.querySelectorAll("*")) {
          if (node.shadowRoot) roots.push(node.shadowRoot);
        }
        for (const name of root.querySelectorAll(
          ".user-name,.user-name-text,#user-name",
        )) {
          let badge = name.querySelector("[data-bcx-ip]"),
            id = "";
          // closest() stops at each ShadowRoot. Modern comment components put
          // reply identity on an outer renderer and the username deeper down.
          for (
            let node = name;
            node;
            node = node.parentElement || node.getRootNode?.().host
          ) {
            const candidate =
              node.getAttribute?.("data-rpid") ||
              node.getAttribute?.("rpid") ||
              node.getAttribute?.("data-id");
            if (/^\d+$/.test(candidate || "")) {
              id = candidate;
              break;
            }
          }
          const uid =
            name.getAttribute("data-user-profile-id") ||
            name
              .querySelector("[data-user-profile-id]")
              ?.getAttribute("data-user-profile-id") ||
            String(name.href || name.querySelector("a")?.href || "").match(
              /space\.bilibili\.com\/(\d+)/,
            )?.[1];
          const location = id
            ? context.comments.get(id)
            : context.comments.get("uid:" + uid);
          if (typeof location !== "string" || !location.trim()) {
            badge?.remove();
            ipBadges.delete(badge);
            continue;
          }
          if (!badge) {
            badge = F.create("span", undefined, { "data-bcx-ip": "1" });
            badge.style.cssText =
              "display:inline;margin-left:6px;color:var(--text3,#9499a0);font-size:12px;font-weight:400;white-space:nowrap;vertical-align:baseline;border:1px solid var(--text3,#d8d8d8);border-radius:2px;padding:0 2px";
            name.append(badge);
          }
          badge.textContent = location;
          ipBadges.add(badge);
        }
      }
      if (context.commentIpDiagnostics)
        context.commentIpDiagnostics.painted = ipBadges.size;
    }
    scope.on(window, "bili-codex-comments-change", () => {
      if (s.commentIp) commentIps();
    });
    scope.on(document, "fullscreenchange", updateFullscreen);
    if (speedEnabled) {
      const editing = (event) =>
        (event.composedPath?.() || [event.target]).some(
          (node) =>
            node?.isContentEditable ||
            /^(INPUT|TEXTAREA|SELECT)$/.test(node?.tagName),
        );
      const releaseRight = () => {
        if (!holdingRight) return;
        clearTimeout(restoreTimer);
        restoreTimer = setTimeout(() => {
          holdingRight = false;
          applyRate();
        }, 100);
      };
      scope.on(
        document,
        "keydown",
        (event) => {
          if (
            event.code !== "ArrowRight" ||
            event.defaultPrevented ||
            event.ctrlKey ||
            event.altKey ||
            event.metaKey ||
            BiliConfig.matchesShortcut(event, s.speedUpShortcut) ||
            BiliConfig.matchesShortcut(event, s.speedDownShortcut) ||
            s.presetShortcuts.some((key) =>
              BiliConfig.matchesShortcut(event, key),
            ) ||
            editing(event)
          )
            return;
          clearTimeout(restoreTimer);
          holdingRight = true;
        },
        true,
      );
      scope.on(document, "keyup", (event) => {
        if (event.code === "ArrowRight") releaseRight();
      });
      scope.on(window, "blur", releaseRight);
      scope.disposers.push(() => clearTimeout(restoreTimer));
      scope.on(document, "keydown", (event) => {
        if (event.defaultPrevented || editing(event)) return;
        if (
          BiliConfig.matchesShortcut(event, s.speedUpShortcut) ||
          BiliConfig.matchesShortcut(event, s.speedDownShortcut)
        ) {
          event.preventDefault();
          setRate(
            (video?.playbackRate || s.speed) +
              (BiliConfig.matchesShortcut(event, s.speedUpShortcut)
                ? s.step
                : -s.step),
          );
        } else if (
          s.presetShortcuts.some((key) =>
            BiliConfig.matchesShortcut(event, key),
          )
        ) {
          event.preventDefault();
          setRate(
            s.shortcutRates[
              s.presetShortcuts.findIndex((key) =>
                BiliConfig.matchesShortcut(event, key),
              )
            ],
          );
        }
      });
    }
    scope.interval(scan, 1200);
    scan();
    scope.disposers.push(() => {
      detachVideo();
      restoreMenu();
      for (const badge of ipBadges) badge.remove();
      ipBadges.clear();
      if (context.commentIpDiagnostics)
        context.commentIpDiagnostics.painted = 0;
    });
    return () => scope.clean();
  });
})();
