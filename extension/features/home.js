(() => {
  "use strict";
  const F = BiliFeatures;
  F.register("home", (settings, context) => {
    const s = settings.home,
      scope = new F.Scope();
    let stopped = false;
    scope.disposers.push(() => {
      stopped = true;
    });
    if (location.hostname !== "www.bilibili.com" || location.pathname !== "/")
      return () => {};
    let preview,
      hoverTimer,
      hideTimer,
      hoverId = 0,
      currentCard = null,
      historyWidget,
      historyText,
      previous,
      next;
    const prefetched = new Set();
    const info = async (bvid) => {
      if (!context.details.has(bvid)) {
        const response = await chrome.runtime.sendMessage({
          type: "bili-api",
          task: "view",
          bvid,
        });
        if (!response?.ok) throw Error(response?.error || "视频信息读取失败。");
        context.details.set(bvid, response.data);
        if (context.details.size > 120)
          context.details.delete(context.details.keys().next().value);
      }
      return context.details.get(bvid);
    };
    if (s.minimal) {
      document.documentElement.setAttribute("data-bcx-minimal", "1");
      scope.disposers.push(() =>
        document.documentElement.removeAttribute("data-bcx-minimal"),
      );
      const style = F.create("style");
      style.textContent =
        "html[data-bcx-minimal] #i_cecream,html[data-bcx-minimal] #app,html[data-bcx-minimal] #bili-header-container{display:none!important}";
      scope.node(style);
      const w = F.widget(
        "minimal",
        ":host{position:fixed;inset:0;display:grid;place-items:center;z-index:9999;background:#faf7f9;background-size:cover;background-position:center}.search{width:min(560px,calc(100vw - 40px));padding:30px;background:#fff;border-radius:14px;box-shadow:0 8px 34px #2222}h1{font-size:23px;margin:0 0 22px}form{display:flex;gap:8px}input{min-width:0;flex:1;padding:12px;border:1px solid #ccb9c4;border-radius:8px}button{padding:10px 18px}p{font-size:12px;color:#756770;margin:20px 0 0}",
      );
      if (s.backgroundUrl && s.backgroundSource === "url")
        w.host.style.backgroundImage =
          "url(" + JSON.stringify(s.backgroundUrl) + ")";
      const box = F.create("div", undefined, { class: "search" }),
        form = F.create("form"),
        input = F.create("input", undefined, {
          type: "search",
          placeholder: "搜索视频、UP主或课程",
          "aria-label": "搜索 B站",
          required: "required",
        }),
        button = F.create("button", "搜索", { type: "submit" });
      form.append(input, button);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (input.value.trim())
          location.href =
            "https://search.bilibili.com/all?keyword=" +
            encodeURIComponent(input.value.trim());
      });
      box.append(
        F.create("h1", "在 B站，专注一件事"),
        form,
        F.create("p", "极简首页已开启，可在 小电视助手 · BiliPlus设置中关闭。"),
      );
      w.shadow.append(box);
      scope.node(w.host);
      if (s.backgroundSource === "local")
        chrome.storage.local.get("localBackground").then((data) => {
          try {
            const background = BiliUI.validateBackground(data.localBackground);
            w.host.style.backgroundImage =
              "url(" + JSON.stringify(background.dataUrl) + ")";
          } catch {}
        });
      return () => scope.clean();
    }
    if (s.history) {
      const w = F.widget(
        "history",
        ":host{position:fixed;left:18px;bottom:18px;z-index:999999}.bar{display:flex;gap:8px;align-items:center;padding:9px 12px;border-radius:10px;background:#fff;box-shadow:0 5px 24px #2222}.label{font-size:12px;color:#735c68}",
      );
      historyWidget = w.host;
      const bar = F.create("div", undefined, { class: "bar" });
      previous = F.create("button", "上一批", { type: "button" });
      next = F.create("button", "下一批", { type: "button" });
      historyText = F.create("span", "等待推荐数据…", {
        class: "label",
        role: "status",
      });
      bar.append(previous, historyText, next);
      w.shadow.append(bar);
      scope.node(historyWidget);
      const entries = [];
      let position = -1,
        overlay = null,
        captureTimer,
        closed = false,
        lastCandidate = "",
        managedLimit = 0;
      const feedRoot = () =>
        document
          .querySelector(".recommended-container_floor-aside")
          ?.querySelector(
            ".container.is-version8,.container.is-version9,.container",
          ) ||
        document.querySelector(".container.is-version8,.container.is-version9");
      function cards(root = feedRoot()) {
        if (!root) return [];
        // Top refresh slots use .feed-card; direct .bili-feed-card siblings
        // belong to the independently loaded infinite feed on current Bilibili.
        let list = [...root.children].filter((node) =>
          node.matches?.(".feed-card"),
        );
        if (!list.length)
          list = [...root.children].filter((node) =>
            node.matches?.(".bili-feed-card"),
          );
        if (!list.length)
          list = [
            ...root.querySelectorAll(".feed-card,.bili-feed-card"),
          ].filter(
            (node) =>
              !node.parentElement?.closest(".feed-card,.bili-feed-card"),
          );
        if (!list.length)
          list = [...root.querySelectorAll(".bili-video-card")].filter(
            (node) =>
              !node.closest(".recommended-swipe,.recommended-swipe-shim"),
          );
        list = list.filter((node) => {
          if (node.hidden || node.getAttribute("aria-hidden") === "true")
            return false;
          try {
            const style = getComputedStyle(node);
            if (style.display === "none" || style.visibility === "hidden")
              return false;
            const rect = node.getBoundingClientRect?.();
            if (rect && rect.width === 0 && rect.height === 0) return false;
          } catch {}
          return true;
        });
        return managedLimit ? list.slice(0, managedLimit) : list;
      }
      function readView() {
        const nodes = cards(),
          items = [];
        for (const node of nodes) {
          const a = node.querySelector('a[href*="/video/BV"]'),
            bvid = F.bvidFrom(a?.href);
          if (!bvid) continue;
          const title =
            node.querySelector("h3,.bili-video-card__info--tit")?.textContent ||
            a.title ||
            "";
          items.push({ bvid, title });
        }
        return {
          nodes,
          items,
          key: items.map((item) => item.bvid + ":" + item.title).join("|"),
        };
      }
      function setHistory(error = "") {
        context.history = {
          count: entries.length,
          index: position,
          pending: false,
          error,
          source: "rendered-cards",
        };
        updateHistory();
      }
      function cloneCard(node) {
        const clone = node.cloneNode(true),
          originalImages = [...node.querySelectorAll("img")];
        for (const own of clone.querySelectorAll(
          "script,iframe,object,[data-bcx-cover],[data-bcx-widget]",
        ))
          own.remove();
        for (const item of [clone, ...clone.querySelectorAll("*")])
          for (const attribute of [...item.attributes])
            if (
              /^on/i.test(attribute.name) ||
              /^data-bcx-/.test(attribute.name)
            )
              item.removeAttribute(attribute.name);
        for (const [index, image] of [
          ...clone.querySelectorAll("img"),
        ].entries()) {
          const original = originalImages[index],
            current = original?.currentSrc || "",
            lazy = original?.getAttribute("data-src") || "",
            raw = original?.getAttribute("src") || "";
          const src =
            current && !current.startsWith("data:")
              ? current
              : lazy || raw || current;
          if (src) image.setAttribute("src", src);
          image.setAttribute("loading", "eager");
          image.setAttribute("decoding", "async");
          image.style.opacity = "1";
          image.style.visibility = "visible";
          const picture = image.closest("picture"),
            originalPicture = original?.closest("picture");
          if (current && !current.startsWith("data:")) {
            image.removeAttribute("srcset");
            for (const source of picture?.querySelectorAll("source") || [])
              source.removeAttribute("srcset");
          } else {
            if (
              !image.getAttribute("srcset") &&
              image.getAttribute("data-srcset")
            )
              image.setAttribute("srcset", image.getAttribute("data-srcset"));
            const originals = [
              ...(originalPicture?.querySelectorAll("source") || []),
            ];
            for (const [i, source] of [
              ...(picture?.querySelectorAll("source") || []),
            ].entries()) {
              const srcset =
                originals[i]?.getAttribute("srcset") ||
                originals[i]?.getAttribute("data-srcset");
              if (srcset) source.setAttribute("srcset", srcset);
            }
          }
        }
        return clone;
      }
      function recordView() {
        if (closed || overlay || location.pathname !== "/") return;
        const view = readView();
        if (!view.items.length) return;
        if (!managedLimit) managedLimit = view.nodes.length;
        const visualKey = view.nodes
          .flatMap((node) =>
            [...node.querySelectorAll("img,source")].map((image) =>
              [
                image.currentSrc,
                image.getAttribute("src"),
                image.getAttribute("data-src"),
                image.getAttribute("srcset"),
                image.getAttribute("data-srcset"),
              ].join(":"),
            ),
          )
          .join("|");
        if (
          entries[entries.length - 1]?.key === view.key &&
          entries[entries.length - 1]?.visualKey === visualKey
        ) {
          if (position !== entries.length - 1 || context.history?.error) {
            position = entries.length - 1;
            setHistory();
          }
          return;
        }
        const snapshot = {
          key: view.key,
          visualKey,
          items: view.items,
          nodes: view.nodes.map(cloneCard),
        };
        if (entries[entries.length - 1]?.key === view.key)
          entries[entries.length - 1] = snapshot;
        else {
          entries.push(snapshot);
          if (entries.length > s.historyLimit) entries.shift();
        }
        position = entries.length - 1;
        lastCandidate = view.key;
        setHistory();
      }
      function restoreNative() {
        if (!overlay) return;
        for (const clone of overlay.clones) clone.remove();
        for (const original of overlay.originals)
          if (original.marker.isConnected)
            original.marker.replaceWith(original.node);
        overlay = null;
      }
      function scheduleCapture() {
        if (closed || overlay || location.pathname !== "/") return;
        const view = readView();
        if (view.key === lastCandidate && captureTimer) return;
        lastCandidate = view.key;
        clearTimeout(captureTimer);
        captureTimer = setTimeout(() => {
          captureTimer = null;
          recordView();
        }, 160);
      }
      function navigate(delta) {
        if (closed || location.pathname !== "/" || ![-1, 1].includes(delta))
          return;
        clearTimeout(captureTimer);
        captureTimer = null;
        if (!overlay) recordView();
        const target = position + delta,
          entry = entries[target];
        if (!entry) return;
        const oldPosition = position;
        restoreNative();
        const current = cards();
        if (!current.length) {
          setHistory("当前首页推荐区域已重建，请刷新页面后重试。");
          return;
        }
        const originals = current.map((node) => {
          const marker = document.createComment("bili-codex-history-card");
          node.before(marker);
          node.remove();
          return { node, marker };
        });
        const clones = entry.nodes.map((node) => node.cloneNode(true));
        originals[0].marker.before(...clones);
        overlay = { originals, clones };
        if (readView().key !== entry.key) {
          restoreNative();
          position = oldPosition;
          setHistory("历史卡片未能恢复，请刷新页面后重试。");
          return;
        }
        position = target;
        lastCandidate = entry.key;
        setHistory();
        const metadata = entry.items.map((item) => ({
          ...context.videos.get(item.bvid),
          ...item,
        }));
        window.dispatchEvent(
          new CustomEvent("bili-codex-data", {
            detail: JSON.stringify({ videos: metadata }),
          }),
        );
      }
      previous.addEventListener("click", () => navigate(-1));
      next.addEventListener("click", () => navigate(1));
      scope.on(window, "bili-codex-history", (event) => {
        try {
          navigate(Number(JSON.parse(event.detail).delta));
        } catch {}
      });
      function nativeUpdate() {
        restoreNative();
        recordView();
        scheduleCapture();
      }
      scope.on(window, "bili-codex-data", (event) => {
        try {
          const data = JSON.parse(event.detail);
          if (data.homeFeed?.phase === "request") nativeUpdate();
          else if (data.homeFeed?.phase === "response") scheduleCapture();
        } catch {}
      });
      scope.on(
        document,
        "click",
        (event) => {
          const target = event.target?.closest?.(
            ".feed-roll-btn .roll-btn,button.feed-roll-btn,button.roll-btn,.recommended-container_floor-aside button.change-btn",
          );
          if (target) nativeUpdate();
        },
        true,
      );
      if (typeof window.MutationObserver === "function") {
        const observer = new window.MutationObserver(() => {
          if (overlay && !overlay.clones.some((node) => node.isConnected))
            restoreNative();
          scheduleCapture();
        });
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["href", "src", "data-src"],
        });
        scope.disposers.push(() => observer.disconnect());
      }
      scope.disposers.push(() => {
        closed = true;
        clearTimeout(captureTimer);
        restoreNative();
        entries.length = 0;
        context.history = { count: 0, index: -1, pending: false };
      });
      recordView();
    }
    function showCover(url, title) {
      const dialog = F.create("dialog", undefined, {
        "data-bcx-widget": "cover",
        "aria-label": "视频原始封面",
      });
      dialog.style.cssText =
        "border:0;border-radius:14px;padding:18px;background:#fff;max-width:94vw;max-height:94vh";
      const image = F.create("img", undefined, {
        src: url,
        alt: title || "视频封面",
      });
      image.style.cssText =
        "display:block;max-width:88vw;max-height:78vh;object-fit:contain";
      const bar = F.create("div");
      bar.style.cssText =
        "display:flex;justify-content:space-between;gap:20px;padding-top:12px";
      const link = F.create("a", "打开原图", {
          href: url,
          target: "_blank",
          rel: "noreferrer",
        }),
        close = F.create("button", "关闭", { type: "button" });
      bar.append(link, close);
      dialog.append(image, bar);
      scope.node(dialog, document.body);
      close.addEventListener("click", () => dialog.close());
      dialog.addEventListener("close", () => dialog.remove(), { once: true });
      dialog.addEventListener("click", (e) => {
        if (e.target === dialog) dialog.close();
      });
      dialog.showModal();
    }
    function coverButtons() {
      if (!s.coverZoom) return;
      for (const card of document.querySelectorAll(F.CARD)) {
        if (
          card.parentElement?.closest(F.CARD) ||
          card.querySelector("[data-bcx-cover]")
        )
          continue;
        const bvid = F.bvidFrom(
          card.querySelector('a[href*="/video/BV"]')?.href,
        );
        if (!bvid) continue;
        const button = F.create("button", undefined, {
          type: "button",
          "data-bcx-cover": "1",
          "aria-label": "查看封面",
          title: "查看封面",
        });
        const icon = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "svg",
          ),
          corners = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "path",
          );
        icon.setAttribute("viewBox", "0 0 24 24");
        icon.setAttribute("width", "18");
        icon.setAttribute("height", "18");
        icon.setAttribute("aria-hidden", "true");
        corners.setAttribute(
          "d",
          "M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5M8 16l3-4 3 3 2-2",
        );
        corners.setAttribute("fill", "none");
        corners.setAttribute("stroke", "currentColor");
        corners.setAttribute("stroke-width", "1.7");
        corners.setAttribute("stroke-linecap", "round");
        corners.setAttribute("stroke-linejoin", "round");
        icon.append(corners);
        button.append(icon);
        button.style.cssText =
          "position:absolute;top:8px;left:8px;right:auto;z-index:10;border:0;border-radius:5px;width:28px;height:28px;padding:5px;background:#202124b8;color:#fff;cursor:pointer";
        const prior = card.style.position;
        if (getComputedStyle(card).position === "static")
          card.style.position = "relative";
        button.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          try {
            const data = await info(bvid);
            if (stopped || !button.isConnected) return;
            showCover(
              F.cdnUrl(String(data.pic).replace(/^http:/, "https:")),
              data.title,
            );
          } catch (error) {
            button.title = error.message + "，点击重试";
          }
        });
        card.append(button);
        scope.disposers.push(() => {
          button.remove();
          card.style.position = prior;
        });
      }
    }
    if (s.coverZoom) {
      const style = F.create("style");
      style.textContent =
        "[data-bcx-cover]{opacity:0;transition:opacity .15s}[data-bcx-cover]:focus-visible,.bili-video-card:hover>[data-bcx-cover],.bili-video-card:focus-within>[data-bcx-cover],.video-page-card-small:hover>[data-bcx-cover],.video-page-card-small:focus-within>[data-bcx-cover],.video-list-item:hover>[data-bcx-cover],.video-list-item:focus-within>[data-bcx-cover]{opacity:1}[data-bcx-cover]:focus-visible{outline:2px solid #fb7299;outline-offset:2px}@media(hover:none){[data-bcx-cover]{opacity:1}}@media(prefers-reduced-motion:reduce){[data-bcx-cover]{transition:none}}";
      scope.node(style);
    }
    async function showPreview(card, bvid, id) {
      const w = F.widget(
        "preview",
        ":host{position:fixed;z-index:2147482000;width:340px;background:#fff;border-radius:12px;box-shadow:0 7px 32px #2223;overflow:hidden}.image{width:340px;height:190px;position:relative;overflow:hidden;background:#eee}.image img{position:absolute;top:0;left:0;max-width:none}.copy{padding:12px 15px}h3{font-size:14px;margin:0 0 7px}p{font-size:12px;color:#756570;line-height:1.7;margin:0;max-height:85px;overflow:auto}input{width:100%;accent-color:#bc2c66}.message{padding:15px;color:#756570;font-size:12px}",
      );
      const loading = F.create("p", "正在读取视频预览…", { class: "message" });
      w.shadow.append(loading);
      preview = w.host;
      const rect = card.getBoundingClientRect();
      preview.style.left =
        Math.max(10, Math.min(innerWidth - 350, rect.left)) + "px";
      preview.style.top =
        (rect.bottom + 12 + 280 < innerHeight
          ? rect.bottom + 12
          : Math.max(10, rect.top - 300)) + "px";
      document.documentElement.append(preview);
      try {
        const data = await info(bvid);
        if (id !== hoverId) return;
        loading.remove();
        const imageBox = F.create("div", undefined, { class: "image" }),
          image = F.create("img", undefined, {
            alt: "视频预览画面",
            src: F.cdnUrl(String(data.pic).replace(/^http:/, "https:")),
          });
        image.style.width = "340px";
        image.style.height = "190px";
        image.style.objectFit = "cover";
        imageBox.append(image);
        const copy = F.create("div", undefined, { class: "copy" });
        copy.append(
          F.create("h3", data.title),
          F.create("p", data.desc || "暂无简介。"),
        );
        w.shadow.append(imageBox, copy);
        const response = await chrome.runtime.sendMessage({
          type: "bili-api",
          task: "videoshot",
          bvid,
        });
        if (id !== hoverId || !response?.ok) return;
        const shot = response.data;
        if (
          !Array.isArray(shot?.image) ||
          !shot.image.length ||
          !shot.image_x_len ||
          !shot.image_y_len
        )
          return;
        const slider = F.create("input", undefined, {
          type: "range",
          min: 0,
          max: Math.max(1, (shot.index?.length || 1) - 1),
          value: 0,
          "aria-label": "预览视频位置",
        });
        copy.append(slider);
        const update = (value) => {
          const i = Number(value),
            cols = shot.image_x_len,
            rows = shot.image_y_len,
            sheet = Math.floor(i / (cols * rows)),
            local = i % (cols * rows);
          if (!shot.image[sheet]) return;
          image.src = F.cdnUrl(
            String(shot.image[sheet]).replace(/^http:/, "https:"),
          );
          image.style.width = cols * 340 + "px";
          image.style.height = rows * 190 + "px";
          image.style.objectFit = "fill";
          image.style.transform =
            "translate(" +
            -(local % cols) * 340 +
            "px," +
            -Math.floor(local / cols) * 190 +
            "px)";
        };
        slider.addEventListener("input", () => update(slider.value));
        imageBox.addEventListener("pointermove", (event) => {
          const rect = imageBox.getBoundingClientRect();
          slider.value = Math.floor(
            Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) *
              Number(slider.max),
          );
          update(slider.value);
        });
        update(0);
      } catch (error) {
        if (id === hoverId) loading.textContent = error.message;
      }
    }
    if (s.preview) {
      scope.on(document, "pointerover", (event) => {
        if (event.target?.closest?.("[data-bcx-widget]")) {
          clearTimeout(hideTimer);
          return;
        }
        const card = event.target?.closest?.(F.CARD);
        if (!card || card === currentCard) return;
        currentCard = card;
        clearTimeout(hideTimer);
        clearTimeout(hoverTimer);
        preview?.remove();
        const bvid = F.bvidFrom(
          card.querySelector('a[href*="/video/BV"]')?.href,
        );
        const id = ++hoverId;
        if (bvid)
          hoverTimer = setTimeout(
            () => showPreview(card, bvid, id),
            s.previewDelay,
          );
      });
      scope.on(document, "pointerout", (event) => {
        if (
          currentCard &&
          !currentCard.contains(event.relatedTarget) &&
          !preview?.contains(event.relatedTarget)
        ) {
          clearTimeout(hideTimer);
          hideTimer = setTimeout(() => {
            currentCard = null;
            ++hoverId;
            clearTimeout(hoverTimer);
            preview?.remove();
            preview = null;
          }, 220);
        }
      });
      scope.disposers.push(() => {
        clearTimeout(hoverTimer);
        clearTimeout(hideTimer);
        ++hoverId;
        preview?.remove();
      });
    }
    let optimized = 0;
    function optimize() {
      if (!s.optimizeLoading) return;
      for (const image of document.querySelectorAll(".bili-video-card img")) {
        if (image.getBoundingClientRect().top < innerHeight + 600) {
          if (!image.hasAttribute("data-bcx-image")) {
            const old = {
              loading: image.getAttribute("loading"),
              decoding: image.getAttribute("decoding"),
            };
            image.setAttribute("data-bcx-image", "1");
            image.loading = "eager";
            image.decoding = "async";
            scope.disposers.push(() => {
              for (const [key, value] of Object.entries(old))
                value === null
                  ? image.removeAttribute(key)
                  : image.setAttribute(key, value);
              image.removeAttribute("data-bcx-image");
            });
          }
        }
      }
      for (const card of document.querySelectorAll(F.CARD)) {
        if (optimized >= 36) break;
        const bvid = F.bvidFrom(
          card.querySelector('a[href*="/video/BV"]')?.href,
        );
        if (
          bvid &&
          !prefetched.has(bvid) &&
          card.getBoundingClientRect().top < innerHeight + 600
        ) {
          prefetched.add(bvid);
          optimized++;
          void info(bvid).catch(() => {});
          if (prefetched.size % 2 === 0) break;
        }
      }
    }
    if (s.optimizeLoading) {
      let pending = false,
        failures = 0,
        cooldownUntil = 0,
        loadTimer,
        restoreTimer,
        anchorRestore = null,
        beforeCount = 0;
      const restoreAnchor = () => {
        anchorRestore?.();
        anchorRestore = null;
      };
      const unlock = (success) => {
        if (!pending) return;
        pending = false;
        clearTimeout(loadTimer);
        clearTimeout(restoreTimer);
        restoreAnchor();
        if (success) failures = 0;
        else if (++failures >= s.maxConsecutiveTimeouts) {
          cooldownUntil = Date.now() + s.cooldownMs;
          failures = 0;
        }
      };
      const cards = () =>
        document.querySelectorAll(".bili-feed-card,.feed-card").length;
      function preload() {
        if (pending || Date.now() < cooldownUntil || context.filterTripped)
          return;
        const height = Math.max(
          document.documentElement.scrollHeight || 0,
          document.body?.scrollHeight || 0,
        );
        if (
          height - (window.scrollY + innerHeight) >=
          innerHeight * s.thresholdMultiplier
        )
          return;
        const anchor = document.querySelector(".load-more-anchor");
        if (!anchor) return;
        const bottom = anchor.getBoundingClientRect().bottom;
        pending = true;
        beforeCount = cards();
        const prior = {
          transform: anchor.style.transform,
          visibility: anchor.style.visibility,
          pointerEvents: anchor.style.pointerEvents,
        };
        if (bottom > innerHeight) {
          anchor.style.transform = "translateY(" + (-bottom - 1) + "px)";
          anchor.style.visibility = "hidden";
          anchor.style.pointerEvents = "none";
          anchorRestore = () => {
            Object.assign(anchor.style, prior);
          };
        }
        loadTimer = setTimeout(() => unlock(false), s.unlockTimeoutMs);
        restoreTimer = setTimeout(restoreAnchor, 300);
        window.dispatchEvent(new Event("scroll"));
      }
      if (typeof window.MutationObserver === "function") {
        const observer = new window.MutationObserver(() => {
          if (pending && cards() > beforeCount) unlock(true);
        });
        observer.observe(
          document.querySelector(
            ".container.is-version8,.container.is-version9",
          ) || document.body,
          { childList: true, subtree: true },
        );
        scope.disposers.push(() => observer.disconnect());
      }
      scope.on(window, "scroll", preload, { passive: true });
      scope.interval(preload, s.routeCheckIntervalMs || 750);
      scope.disposers.push(() => {
        clearTimeout(loadTimer);
        clearTimeout(restoreTimer);
        restoreAnchor();
      });
    }
    function updateHistory() {
      if (!historyText) return;
      const h = context.history;
      const label = h?.pending
        ? "正在恢复…"
        : h?.error ||
          (h?.count
            ? "第 " + (h.index + 1) + " / " + h.count + " 批"
            : "等待推荐数据…");
      if (historyText.textContent !== label) historyText.textContent = label;
      const previousDisabled = !!h?.pending || !h?.count || h.index <= 0,
        nextDisabled = !!h?.pending || !h?.count || h.index >= h.count - 1;
      if (previous.disabled !== previousDisabled)
        previous.disabled = previousDisabled;
      if (next.disabled !== nextDisabled) next.disabled = nextDisabled;
    }
    function scan() {
      coverButtons();
      optimize();
      updateHistory();
    }
    scope.interval(scan, 1500);
    scan();
    return () => scope.clean();
  });
})();
