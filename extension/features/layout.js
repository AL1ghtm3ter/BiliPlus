(() => {
  "use strict";
  const F = BiliFeatures;
  F.register("layout", (settings, context) => {
    const scope = new F.Scope();
    const s = settings.layout;
    if (!BiliConfig.isPlaybackLocation(location)) return () => {};
    let shell,
      side,
      left,
      innerScope,
      controlHost,
      playerNode,
      playerPlaceholder,
      stopped = false;
    const currentPlayer = () =>
      document.querySelector("#playerWrap") ||
      document.querySelector("#bilibili-player");
    function control() {
      if (stopped) return;
      const bar = currentPlayer()?.querySelector(
        ".bpx-player-control-bottom-right",
      );
      if (!bar) return;
      if (controlHost?.parentNode === bar) return;
      if (controlHost) {
        const pip = bar.querySelector(".bpx-player-ctrl-pip");
        pip ? pip.after(controlHost) : bar.append(controlHost);
        return;
      }
      const widget = F.widget(
        "split-control",
        ":host{display:inline-flex;align-items:center;justify-content:center;flex:0 0 36px;width:36px;height:100%;margin:0;color:#fff}button{display:grid;place-items:center;box-sizing:border-box;width:36px;height:36px;min-width:0;padding:6px;border:0;border-radius:4px;background:transparent;color:inherit;line-height:1}button:hover{background:#ffffff1a}button:focus-visible{outline:2px solid #fff;outline-offset:-2px}button[data-highlight=true]{color:#ff6699}svg{display:block;width:24px;height:24px;pointer-events:none}",
      );
      const active = !!(s.split && s.splitActive);
      const button = F.create("button", undefined, {
        type: "button",
        "aria-pressed": String(active),
        "aria-label": active ? "关闭左右分屏" : "开启左右分屏",
        title: active ? "关闭左右分屏" : "开启左右分屏",
        "data-highlight": String(active && s.highlightControlButton),
      });
      const icon = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "svg",
        ),
        panes = document.createElementNS("http://www.w3.org/2000/svg", "path");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("aria-hidden", "true");
      panes.setAttribute("d", "M3.5 5.5h17v13h-17zM14.5 5.5v13");
      panes.setAttribute("fill", "none");
      panes.setAttribute("stroke", "currentColor");
      panes.setAttribute("stroke-width", "1.8");
      panes.setAttribute("stroke-linejoin", "round");
      icon.append(panes);
      button.append(icon);
      scope.on(button, "click", (event) => {
        if (stopped) return;
        event.preventDefault();
        event.stopPropagation();
        if (!s.split) {
          context.patch("layout.splitActive", true);
          context.patch("layout.split", true);
        } else context.patch("layout.splitActive", !s.splitActive);
      });
      widget.shadow.append(button);
      controlHost = widget.host;
      const pip = bar.querySelector(".bpx-player-ctrl-pip");
      pip ? pip.after(controlHost) : bar.append(controlHost);
      scope.disposers.push(() => controlHost?.remove());
    }
    function followPlayer(player) {
      if (!player) return;
      if (player !== playerNode && !shell.contains(player)) {
        playerPlaceholder?.remove();
        playerPlaceholder = document.createComment(
          "bili-codex-player-location",
        );
        player.before(playerPlaceholder);
      }
      playerNode = player;
      if (player.parentNode !== left) left.append(player);
    }
    function mount() {
      if (shell?.isConnected) {
        followPlayer(currentPlayer());
        return;
      }
      if (
        !BiliConfig.isPlaybackLocation(location) ||
        (!(s.split && s.splitActive) && !s.rightComments)
      )
        return;
      const player = currentPlayer();
      if (!player?.parentElement) return;
      innerScope?.clean();
      innerScope = new F.Scope();
      const originalLayout = document.documentElement.getAttribute(
        "data-bcx-wide-layout",
      );
      document.documentElement.setAttribute("data-bcx-wide-layout", "1");
      innerScope.disposers.push(() =>
        originalLayout === null
          ? document.documentElement.removeAttribute("data-bcx-wide-layout")
          : document.documentElement.setAttribute(
              "data-bcx-wide-layout",
              originalLayout,
            ),
      );
      shell = F.create("div", undefined, { "data-bcx-split": "1" });
      left = F.create("div", undefined, { "data-bcx-left": "1" });
      side = F.create("aside", undefined, {
        "data-bcx-side": "1",
        "aria-label": "视频侧栏",
      });
      const style = F.create("style");
      style.textContent =
        "html[data-bcx-wide-layout] #mirror-vdcon>.left-container,html[data-bcx-wide-layout] .playlist-container--left{width:calc(100vw - 120px)!important;max-width:none!important}html[data-bcx-wide-layout] #mirror-vdcon>.right-container,html[data-bcx-wide-layout] .playlist-container--right{display:none!important}[data-bcx-split]{display:grid;grid-template-columns:minmax(0," +
        (100 - s.sideWidth) +
        "fr) minmax(280px," +
        s.sideWidth +
        "fr);gap:8px;width:100%;min-width:0}[data-bcx-left]{min-width:0}[data-bcx-side]{min-width:0;max-height:80vh;overflow:auto;background:var(--bg1,#fff);border-radius:12px}[data-bcx-side]>[data-bcx-tabs]{display:flex;flex-wrap:wrap;gap:8px;padding:12px;position:sticky;top:0;z-index:10;background:var(--bg1,#fff)}[data-bcx-side] [data-bcx-pane][hidden]{display:none!important}[data-bcx-side] [data-bcx-pane]{padding:0 12px 16px}[data-bcx-side] #commentapp{width:100%!important;margin:0!important}[data-bcx-side] #danmukuBox,[data-bcx-side] .action-list-container,[data-bcx-side] .video-pod{width:100%!important;max-width:100%!important}[data-bcx-side] #playlist-video-action-list-body,[data-bcx-side] #playlist-video-action-list{height:auto!important;max-height:65vh!important;overflow:auto!important}@media(max-width:1000px){[data-bcx-split]{display:block}[data-bcx-split]>[role=separator]{display:none}[data-bcx-side]{margin-top:16px;max-height:70vh}}";
      innerScope.node(style);
      const sidePx =
        s.split && s.splitActive ? s.sideWidthPx : s.commentWidthPx;
      shell.style.gridTemplateColumns =
        "minmax(0,1fr) 8px minmax(280px,min(55vw," + sidePx + "px))";
      player.before(shell);
      innerScope.disposers.push(() => shell.remove());
      const splitter = F.create("div", undefined, {
        role: "separator",
        tabindex: "0",
        "aria-label": "调整视频侧栏宽度",
        "aria-orientation": "vertical",
        "aria-valuemin": "300",
        "aria-valuemax": "800",
        "aria-valuenow": String(sidePx),
      });
      splitter.style.cssText =
        "cursor:col-resize;touch-action:none;border-radius:4px;background:var(--line_regular,#eee)";
      shell.append(left, splitter, side);
      let dragging = false,
        width = sidePx;
      innerScope.on(splitter, "pointerdown", (event) => {
        dragging = true;
        splitter.setPointerCapture?.(event.pointerId);
        event.preventDefault();
      });
      innerScope.on(window, "pointermove", (event) => {
        if (!dragging) return;
        width = Math.max(
          300,
          Math.min(800, shell.getBoundingClientRect().right - event.clientX),
        );
        shell.style.gridTemplateColumns = "minmax(0,1fr) 8px " + width + "px";
        splitter.setAttribute("aria-valuenow", String(Math.round(width)));
      });
      innerScope.on(window, "pointerup", () => {
        if (!dragging) return;
        dragging = false;
        context.patch(
          s.split && s.splitActive
            ? "layout.sideWidthPx"
            : "layout.commentWidthPx",
          Math.round(width),
        );
      });
      innerScope.on(splitter, "keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.code)) return;
        event.preventDefault();
        width = Math.max(
          300,
          Math.min(800, width + (event.code === "ArrowLeft" ? 20 : -20)),
        );
        context.patch(
          s.split && s.splitActive
            ? "layout.sideWidthPx"
            : "layout.commentWidthPx",
          width,
        );
      });
      playerNode = null;
      followPlayer(player);
      innerScope.disposers.push(() => {
        // B站 may replace the player before the next scan or settings restart.
        // Restore the current node, including its controls, instead of reviving
        // the detached player that was initially moved into this shell.
        const current = currentPlayer();
        if (current && shell.contains(current)) playerNode = current;
        if (playerNode?.isConnected && shell.contains(playerNode)) {
          if (playerPlaceholder?.isConnected)
            playerPlaceholder.replaceWith(playerNode);
          else if (shell.isConnected) shell.before(playerNode);
        }
        playerPlaceholder?.remove();
        playerPlaceholder = null;
      });
      const tabs = F.create("div", undefined, {
        "data-bcx-tabs": "1",
        role: "tablist",
      });
      side.append(tabs);
      const panes = [];
      function addTab(name, label, node) {
        const button = F.create("button", label, {
          type: "button",
          role: "tab",
          "aria-selected": "false",
          "data-bcx-tab": name,
        });
        button.style.cssText =
          "font:13px/1.6 sans-serif;border:1px solid #dbc8d1;background:#fff;color:#92244c;border-radius:7px;padding:5px 10px;cursor:pointer";
        const pane = F.create("div", undefined, {
          "data-bcx-pane": name,
          role: "tabpanel",
        });
        pane.hidden = true;
        panes.push({ button, pane });
        tabs.append(button);
        side.append(pane);
        button.addEventListener("click", () => {
          for (const entry of panes) {
            entry.pane.hidden = entry.pane !== pane;
            entry.button.setAttribute(
              "aria-selected",
              String(entry.pane === pane),
            );
          }
          if (name === "ai")
            window.dispatchEvent(new CustomEvent("bili-codex-layout-show"));
          if (s.split && s.splitActive) context.patch("layout.activeTab", name);
        });
        if (node) innerScope.move(node, pane);
        return pane;
      }
      const comments =
        document.querySelector("#commentapp") ||
        document.querySelector(".comment-container") ||
        document.querySelector("bili-comments");
      if (comments) addTab("comments", "评论", comments);
      else
        addTab("comments", "评论").append(
          F.create("p", "评论尚未加载，向下滚动视频页后会自动接入。"),
        );
      if (s.split && s.splitActive) {
        const info = F.create("div");
        info.append(
          F.create(
            "h3",
            document.querySelector("h1")?.textContent || document.title,
          ),
        );
        const desc = document.querySelector(
          "#v_desc .basic-desc-info-text,.basic-desc-info-text,.desc-info-text",
        );
        info.append(
          F.create("p", desc?.textContent || "当前视频简介暂未加载。"),
        );
        addTab("detail", "详情", info);
        for (const [name, label, selector, missing] of [
          [
            "collection",
            "合集",
            ".action-list-container,.video-pod",
            "当前视频没有加载合集列表。",
          ],
          ["danmaku", "弹幕", "#danmukuBox", "弹幕列表尚未加载。"],
          [
            "recommendations",
            "推荐",
            ".recommend-list-container,.recommend-list-v1",
            "相关推荐尚未加载。",
          ],
        ]) {
          const node = document.querySelector(selector),
            pane = addTab(name, label, node);
          if (!node) pane.append(F.create("p", missing));
        }
        context.aiMount = addTab("ai", "AI 助手");
        window.dispatchEvent(new CustomEvent("bili-codex-layout-change"));
      }
      (
        panes.find(
          (entry) => entry.button.getAttribute("data-bcx-tab") === s.activeTab,
        ) || panes[0]
      )?.button.click();
      const resizeTimer = setTimeout(
        () => window.dispatchEvent(new Event("resize")),
        0,
      );
      innerScope.disposers.push(() => clearTimeout(resizeTimer));
    }
    function scan() {
      if (stopped) return;
      control();
      mount();
      if (shell?.isConnected)
        for (const [name, selector] of [
          ["comments", "#commentapp,.comment-container,bili-comments"],
          ["collection", ".action-list-container,.video-pod"],
          ["danmaku", "#danmukuBox"],
          ["recommendations", ".recommend-list-container,.recommend-list-v1"],
        ]) {
          const pane = side.querySelector('[data-bcx-pane="' + name + '"]');
          if (!pane || pane.querySelector(selector)) continue;
          const node = document.querySelector(selector);
          if (node) {
            pane.replaceChildren();
            innerScope.move(node, pane);
          }
        }
    }
    if (s.split || s.rightComments) scope.interval(scan, 1200);
    else {
      // The default-off entry waits for native controls without running a
      // permanent layout timer or moving any B站 content before it is clicked.
      const Observer = globalThis.MutationObserver || window.MutationObserver;
      if (typeof Observer === "function" && document.body) {
        const observer = new Observer(() => control());
        observer.observe(document.body, { childList: true, subtree: true });
        scope.disposers.push(() => observer.disconnect());
      }
    }
    control();
    mount();
    scope.disposers.push(() => {
      stopped = true;
      context.aiMount = null;
      window.dispatchEvent(new CustomEvent("bili-codex-layout-change"));
      innerScope?.clean();
      window.dispatchEvent(new Event("resize"));
    });
    return () => scope.clean();
  });
})();
