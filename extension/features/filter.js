(() => {
  "use strict";
  const F = BiliFeatures;
  F.register("filter-purify", (settings, context) => {
    const scope = new F.Scope(),
      rules = [];
    if (settings.purify.ads)
      rules.push(
        '.ad-report,.bili-ad,.slide-ad,.activity-banner,.video-ad-v1,[data-target-url*="cm.bilibili.com"]{display:none!important}',
      );
    for (const key of settings.purify.hiddenElements) {
      const rule = BiliConfig.HIDDEN[key];
      if (rule?.css) rules.push(rule.css + "{display:none!important}");
    }
    rules.push("[data-bcx-filtered]{display:none!important}");
    const style = F.create("style");
    style.textContent = rules.join("\n");
    scope.node(style);
    const f = settings.filter;
    context.filterTripped = false;
    const placeholders = new Map();
    function clearSearchHints() {
      if (!settings.purify.hiddenElements.includes("searchPlaceholder")) return;
      for (const input of document.querySelectorAll(
        "input.nav-search-input,.nav-search-input input",
      )) {
        if (!placeholders.has(input))
          placeholders.set(input, {
            placeholder: input.getAttribute("placeholder"),
            title: input.getAttribute("title"),
          });
        input.removeAttribute("placeholder");
        input.removeAttribute("title");
      }
    }
    clearSearchHints();
    if (settings.purify.hiddenElements.includes("searchPlaceholder"))
      scope.interval(clearSearchHints, 1200);
    scope.disposers.push(() => {
      context.filterTripped = false;
      for (const [input, attributes] of placeholders)
        for (const [name, value] of Object.entries(attributes))
          value === null
            ? input.removeAttribute(name)
            : input.setAttribute(name, value);
    });
    if (!f.enabled && !f.ads && !f.promoted && !f.labels)
      return () => scope.clean();
    let tripped = false,
      allHiddenBatches = 0,
      lastBatch = "",
      toast;
    const hidden = new Set();
    function metadata(card) {
      const link = card.querySelector(
          'a[href*="/video/BV"],a[href*="live.bilibili.com"],a[href*="/bangumi/"],a[href*="/cheese/"]',
        ),
        bvid = F.bvidFrom(link?.href),
        stored = context.videos.get(bvid || link?.href) || {};
      const href = String(link?.href || ""),
        kind =
          stored.kind ||
          (/live\.bilibili\.com/.test(href)
            ? "live"
            : /\/bangumi\//.test(href)
              ? "bangumi"
              : /\/cheese\//.test(href)
                ? "course"
                : "");
      return {
        bvid,
        title:
          card
            .querySelector(".bili-video-card__info--tit,.title")
            ?.textContent?.trim() ||
          link?.title ||
          stored.title ||
          "",
        author:
          card
            .querySelector(".bili-video-card__info--author,.upname,.up-name")
            ?.textContent?.trim() ||
          stored.author ||
          "",
        authorId:
          String(
            card.querySelector('a[href*="space.bilibili.com"]')?.href || "",
          ).match(/space\.bilibili\.com\/(\d+)/)?.[1] || stored.authorId,
        duration:
          F.duration(
            card.querySelector(".bili-video-card__stats__duration,.duration")
              ?.textContent,
          ) ?? stored.duration,
        plays:
          stored.plays ??
          F.count(
            card.querySelector(".bili-video-card__stats--item,.play")
              ?.textContent,
          ),
        likes: stored.likes,
        danmaku: stored.danmaku,
        publishedAt: stored.publishedAt,
        kind,
        isAd:
          stored.isAd ||
          !!card.querySelector(
            '.bili-video-card__info--ad,.bili-video-card__stats--ad,[class*="ad-tag"],[class*="adLabel"]',
          ),
        promoted:
          stored.promoted ||
          !!card.querySelector(
            ".bili-video-card__info--creative-ad,.is-upower-exclusive,.bili-video-card__info--ad",
          ),
      };
    }
    function scan() {
      const cards = [...document.querySelectorAll(F.CARD)].filter(
        (card) => !card.parentElement?.closest(F.CARD),
      );
      const batch = cards
        .map((c) => F.bvidFrom(c.querySelector('a[href*="/video/BV"]')?.href))
        .join(",");
      let ordinary = 0,
        filtered = 0;
      for (const card of cards) {
        const item = metadata(card);
        if (!item.bvid && !item.isAd && !item.promoted && !item.kind) continue;
        ordinary++;
        const reasons = BiliConfig.matchVideo(
          item,
          tripped
            ? { ...settings, filter: { ...f, enabled: false } }
            : settings,
        );
        const hide = reasons.length > 0;
        if (hide) {
          filtered++;
          card.setAttribute("data-bcx-filtered", "1");
          hidden.add(card);
        } else {
          card.removeAttribute("data-bcx-filtered");
          hidden.delete(card);
        }
      }
      if (batch !== lastBatch && ordinary) {
        lastBatch = batch;
        allHiddenBatches = filtered === ordinary ? allHiddenBatches + 1 : 0;
        if (allHiddenBatches >= 3 && !tripped) {
          tripped = true;
          context.filterTripped = true;
          for (const card of [...hidden]) {
            const independent = BiliConfig.matchVideo(metadata(card), {
              ...settings,
              filter: { ...f, enabled: false },
            });
            if (!independent.length) {
              card.removeAttribute("data-bcx-filtered");
              hidden.delete(card);
            }
          }
          toast = F.create(
            "div",
            "筛选条件连续隐藏了三批推荐，已暂停规则过滤。请在插件设置中放宽条件。",
            { "data-bcx-widget": "filter-notice", role: "status" },
          );
          toast.style.cssText =
            "position:fixed;bottom:20px;left:20px;z-index:999999;max-width:380px;padding:14px;background:#fff1f5;color:#8e2348;border-radius:10px;font-size:13px;box-shadow:0 5px 20px #3332";
          scope.node(toast);
        }
      }
    }
    scope.interval(scan, 1200);
    scan();
    scope.disposers.push(() => {
      for (const card of hidden) card.removeAttribute("data-bcx-filtered");
    });
    return () => scope.clean();
  });
})();
