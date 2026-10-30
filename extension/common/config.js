(function (root) {
  "use strict";
  const DEFAULTS = {
    schema: 3,
    player: {
      speedEnabled: false,
      speed: 1,
      step: 0.25,
      presets: [0.5, 1, 1.5, 2, 3, 4, 5],
      speedUpShortcut: "Alt+ArrowUp",
      speedDownShortcut: "Alt+ArrowDown",
      presetShortcuts: [
        "Shift+Digit1",
        "Shift+Digit2",
        "Shift+Digit3",
        "Shift+Digit4",
        "Shift+Digit5",
      ],
      shortcutRates: [1, 1.5, 2, 3, 5],
      fullscreenProgress: false,
      commentIp: false,
    },
    home: {
      optimizeLoading: false,
      preview: false,
      previewDelay: 650,
      coverZoom: false,
      history: false,
      historyLimit: 8,
      minimal: false,
      backgroundUrl: "",
      backgroundSource: "url",
      thresholdMultiplier: 1.5,
      unlockTimeoutMs: 8000,
      maxConsecutiveTimeouts: 3,
      cooldownMs: 15000,
      routeCheckIntervalMs: 750,
    },
    layout: {
      rightComments: false,
      commentWidthPx: 420,
    },
    filter: {
      enabled: false,
      titleKeywords: [],
      authorNames: [],
      authorIds: [],
      minDuration: 0,
      maxDuration: 0,
      minPlays: 0,
      maxPlays: 0,
      minLikes: 0,
      maxLikes: 0,
      minDanmaku: 0,
      maxDanmaku: 0,
      minLikeRate: 0,
      maxLikeRate: 0,
      publishedAfter: "",
      publishedBefore: "",
      ads: false,
      promoted: false,
      labels: false,
      labelKinds: ["live", "bangumi", "course"],
    },
    purify: { ads: false, hiddenElements: [] },
    appearance: {
      theme: "system",
      dailyQuoteEnabled: true,
      favoriteFeatureIds: [],
      popupGroupCollapseState: ["player", "layout", "filter", "purify"],
    },
  };
  const HIDDEN = {
    searchSuggestions: {
      label: "搜索推荐词",
      css: ".header-search-suggest,.search-suggest,.trending",
    },
    searchPlaceholder: { label: "搜索框默认推荐内容", css: "" },
    hotSearch: {
      label: "搜索热搜榜",
      css: ".trending,.search-panel .history-wrap+.trending",
    },
    homeBanner: {
      label: "首页轮播图",
      css: ".recommended-swipe,.bili-feed4 .recommended-swipe",
    },
    channelBar: {
      label: "首页分区导航",
      css: ".bili-header__channel,.bili-header-channel-panel",
    },
    videoRecommendations: {
      label: "播放页推荐列表",
      css: ".video-page-game-card-small,.video-page-special-card-small,.rec-list,.recommend-list-v1",
    },
    comments: {
      label: "评论区",
      css: "#commentapp,.comment-container,bili-comments",
    },
    danmaku: { label: "视频弹幕", css: ".bpx-player-dm-wrap" },
    headerPromotion: {
      label: "顶栏推广入口",
      css: ".bili-header .vip-entry,.bili-header .download-entry",
    },
    liveSections: { label: "首页直播推荐", css: ".live-card,.bili-live-card" },
    videoActivities: {
      label: "播放页活动推广",
      css: ".video-page-card-small.ad-report,.activity-m-v1,.activity-v1,.video-banner-ad",
    },
    loginReminder: {
      label: "登录引导浮层",
      css: ".login-tip,.bili-mini-mask .login-tip",
    },
  };
  const CATALOG = [
    {
      group: "player",
      title: "功能增强",
      items: [
        [
          "home.optimizeLoading",
          "优化加载",
          "提前预取视频信息，优化已有图片的异步加载",
        ],
        ["home.preview", "极速预览", "悬停卡片显示简介与可拖动预览画面"],
        ["home.coverZoom", "封面放大", "悬停视频卡片可查看和保存原始封面"],
        [
          "home.history",
          "换一换历史",
          "保留当前首页会话的推荐批次，支持前进和后退",
        ],
        ["player.speedEnabled", "无级倍速", "0.1–5 倍速、步进和快捷键"],
        [
          "player.fullscreenProgress",
          "全屏进度条",
          "全屏控制栏收起后仍可查看并拖动进度",
        ],
        [
          "player.commentIp",
          "评论 IP 归属",
          "在评论用户名旁显示 B站返回的公开属地",
        ],
      ],
    },
    {
      group: "layout",
      title: "布局优化",
      items: [
        [
          "layout.rightComments",
          "右侧评论",
          "把评论区移到播放器旁，关闭后还原",
        ],
        ["home.minimal", "极简首页", "首页只显示搜索框，可设置背景图"],
      ],
    },
    {
      group: "filter",
      title: "过滤视频",
      items: [
        ["filter.enabled", "按规则筛选", "标题、作者、时长、播放量和点赞量"],
        ["filter.ads", "过滤广告卡片", "隐藏 B站标注的商业广告"],
        ["filter.promoted", "过滤推广卡片", "隐藏推广和充电专属推荐卡片"],
        ["filter.labels", "过滤特殊类型", "按直播、番剧、课程类型隐藏"],
      ],
    },
    {
      group: "purify",
      title: "界面净化",
      items: [
        ["purify.ads", "隐藏广告区域", "处理已知推广位和页面活动横幅"],
        [
          "purify.hiddenElements",
          "自选隐藏元素",
          "按需隐藏推荐、弹幕、评论等区域",
        ],
      ],
    },
  ];
  function normalize(value = {}) {
    const out = JSON.parse(JSON.stringify(DEFAULTS));
    for (const group of Object.keys(out)) {
      if (
        !out[group] ||
        typeof out[group] !== "object" ||
        Array.isArray(out[group])
      )
        continue;
      const source = value?.[group];
      if (!source || typeof source !== "object") continue;
      for (const key of Object.keys(out[group])) {
        const raw = source[key],
          def = out[group][key];
        if (typeof def === "boolean" && typeof raw === "boolean")
          out[group][key] = raw;
        else if (typeof def === "number" && Number.isFinite(raw))
          out[group][key] = raw;
        else if (typeof def === "string" && typeof raw === "string")
          out[group][key] = raw.slice(0, 16000);
        else if (Array.isArray(def) && Array.isArray(raw))
          out[group][key] = raw
            .filter((x) => typeof x === "string" || typeof x === "number")
            .slice(0, 1000);
      }
    }
    const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
    out.player.speed = clamp(out.player.speed, 0.1, 5);
    out.player.step = clamp(out.player.step, 0.05, 2);
    out.player.presets = out.player.presets
      .map(Number)
      .filter((n) => Number.isFinite(n) && n >= 0.1 && n <= 5)
      .slice(0, 12);
    if (!out.player.presets.length) out.player.presets = [1, 1.5, 2, 3, 5];
    out.player.shortcutRates = out.player.shortcutRates
      .map(Number)
      .filter((n) => Number.isFinite(n) && n >= 0.1 && n <= 5)
      .slice(0, 12);
    out.player.presetShortcuts = out.player.presetShortcuts
      .map(String)
      .slice(0, 12);
    if (out.player.presetShortcuts.length !== out.player.shortcutRates.length)
      throw Error("快捷键与对应倍速的数量必须一致。");
    for (const shortcut of [
      out.player.speedUpShortcut,
      out.player.speedDownShortcut,
      ...out.player.presetShortcuts,
    ])
      parseShortcut(shortcut);
    if (!["url", "local"].includes(out.home.backgroundSource))
      out.home.backgroundSource = "url";
    out.home.thresholdMultiplier = clamp(out.home.thresholdMultiplier, 0.5, 5);
    out.home.unlockTimeoutMs = clamp(out.home.unlockTimeoutMs, 1000, 30000);
    out.home.maxConsecutiveTimeouts = Math.round(
      clamp(out.home.maxConsecutiveTimeouts, 1, 8),
    );
    out.home.cooldownMs = clamp(out.home.cooldownMs, 3000, 120000);
    out.home.routeCheckIntervalMs = clamp(
      out.home.routeCheckIntervalMs,
      250,
      5000,
    );
    out.home.previewDelay = clamp(out.home.previewDelay, 200, 3000);
    out.home.historyLimit = Math.round(clamp(out.home.historyLimit, 2, 12));
    out.layout.commentWidthPx = Math.round(
      clamp(out.layout.commentWidthPx, 300, 800),
    );
    if (!["system", "light", "dark"].includes(out.appearance.theme))
      out.appearance.theme = "system";
    const featureKeys = new Set(
      CATALOG.flatMap((g) => g.items.map((i) => i[0])),
    );
    out.appearance.favoriteFeatureIds =
      out.appearance.favoriteFeatureIds.filter(
        (key) => featureKeys.has(key) && key !== "purify.hiddenElements",
      );
    out.appearance.popupGroupCollapseState =
      out.appearance.popupGroupCollapseState.filter((key) =>
        CATALOG.some((g) => g.group === key),
      );
    out.purify.hiddenElements = out.purify.hiddenElements.filter((k) =>
      Object.hasOwn(HIDDEN, k),
    );
    for (const key of ["titleKeywords", "authorNames", "authorIds"])
      out.filter[key] = [
        ...new Set(
          out.filter[key]
            .map(String)
            .map((x) => x.trim())
            .filter(Boolean),
        ),
      ];
    out.filter.labelKinds = out.filter.labelKinds.filter((x) =>
      ["live", "bangumi", "course"].includes(x),
    );
    for (const key of [
      "minDuration",
      "maxDuration",
      "minPlays",
      "maxPlays",
      "minLikes",
      "maxLikes",
      "minDanmaku",
      "maxDanmaku",
      "minLikeRate",
      "maxLikeRate",
    ])
      out.filter[key] = Math.max(0, Math.min(1e12, out.filter[key]));
    out.filter.minLikeRate = clamp(out.filter.minLikeRate, 0, 100);
    out.filter.maxLikeRate = clamp(out.filter.maxLikeRate, 0, 100);
    for (const name of ["Duration", "Plays", "Likes", "Danmaku", "LikeRate"])
      if (
        out.filter["max" + name] &&
        out.filter["max" + name] < out.filter["min" + name]
      )
        throw Error(name + " 的上限不能小于下限。");
    for (const key of ["publishedAfter", "publishedBefore"])
      if (
        out.filter[key] &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(out.filter[key]) ||
          !Number.isFinite(Date.parse(out.filter[key] + "T00:00:00Z")) ||
          new Date(out.filter[key] + "T00:00:00Z")
            .toISOString()
            .slice(0, 10) !== out.filter[key])
      )
        throw Error("发布日期格式无效。");
    if (
      out.filter.publishedAfter &&
      out.filter.publishedBefore &&
      out.filter.publishedAfter > out.filter.publishedBefore
    )
      throw Error("发布日期起点不能晚于终点。");
    if (
      out.home.backgroundUrl &&
      !/^https:\/\/[^\s]+$/.test(out.home.backgroundUrl) &&
      !/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(
        out.home.backgroundUrl,
      )
    )
      throw Error("背景图仅支持 HTTPS 图片地址。");
    return out;
  }
  function get(config, key) {
    return key.split(".").reduce((v, k) => v?.[k], config);
  }
  function set(config, key, value) {
    const [group, name] = key.split(".");
    if (Object.hasOwn(DEFAULTS, group) && Object.hasOwn(DEFAULTS[group], name))
      config[group][name] = value;
    return config;
  }
  function matchVideo(item, settings) {
    const f = settings.filter;
    const reasons = [];
    if (f.ads && (item.isAd || item.kind === "ad")) reasons.push("广告");
    if (f.promoted && item.promoted) reasons.push("推广");
    if (f.labels && f.labelKinds.includes(item.kind))
      reasons.push("类型：" + item.kind);
    if (f.enabled) {
      if (
        f.titleKeywords.some((k) =>
          String(item.title || "")
            .toLowerCase()
            .includes(k.toLowerCase()),
        )
      )
        reasons.push("标题关键词");
      if (
        f.authorNames.some(
          (k) => String(item.author || "").toLowerCase() === k.toLowerCase(),
        ) ||
        f.authorIds.includes(String(item.authorId || ""))
      )
        reasons.push("作者");
      for (const [field, name] of [
        ["duration", "Duration"],
        ["plays", "Plays"],
        ["likes", "Likes"],
        ["danmaku", "Danmaku"],
        ["likeRate", "LikeRate"],
      ]) {
        const n =
          field === "likeRate"
            ? item.plays > 0 && Number.isFinite(item.likes)
              ? (item.likes / item.plays) * 100
              : undefined
            : item[field];
        if (!Number.isFinite(n)) continue;
        if (
          (f["min" + name] && n < f["min" + name]) ||
          (f["max" + name] && n > f["max" + name])
        )
          reasons.push(
            {
              duration: "时长",
              plays: "播放量",
              likes: "点赞量",
              danmaku: "弹幕数",
              likeRate: "点赞率",
            }[field],
          );
      }
      if (Number.isFinite(item.publishedAt)) {
        const time = item.publishedAt * 1000;
        if (
          (f.publishedAfter &&
            time < new Date(f.publishedAfter + "T00:00:00").getTime()) ||
          (f.publishedBefore &&
            time >=
              new Date(f.publishedBefore + "T00:00:00").getTime() + 86400000)
        )
          reasons.push("发布日期");
      }
    }
    return reasons;
  }
  function parseShortcut(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    const parts = value
      .trim()
      .split("+")
      .map((x) => x.trim());
    const modifiers = { ctrl: false, alt: false, shift: false, meta: false };
    let code = "";
    for (const part of parts) {
      const lower = part.toLowerCase();
      if (
        ["ctrl", "control", "alt", "shift", "meta", "win", "cmd"].includes(
          lower,
        )
      ) {
        modifiers[
          lower === "control"
            ? "ctrl"
            : ["win", "cmd"].includes(lower)
              ? "meta"
              : lower
        ] = true;
        continue;
      }
      if (code) throw Error("快捷键格式无效：" + value);
      code = /^[0-9]$/.test(part)
        ? "Digit" + part
        : /^[a-z]$/i.test(part)
          ? "Key" + part.toUpperCase()
          : part;
    }
    if (
      !/^(Key[A-Z]|Digit[0-9]|Arrow(?:Up|Down|Left|Right)|BracketLeft|BracketRight|Equal|Minus|Space|Period|Comma|F(?:[1-9]|1[0-2]))$/.test(
        code,
      )
    )
      throw Error("快捷键格式无效：" + value);
    return { ...modifiers, code };
  }
  function matchesShortcut(event, value) {
    const key = parseShortcut(value);
    return (
      !!key &&
      event.code === key.code &&
      !!event.ctrlKey === key.ctrl &&
      !!event.altKey === key.alt &&
      !!event.shiftKey === key.shift &&
      !!event.metaKey === key.meta
    );
  }
  function inDurationRange(duration, min, max) {
    return (
      Number.isFinite(duration) &&
      duration > 0 &&
      (!min || duration >= min) &&
      (!max || duration <= max)
    );
  }
  function isPlaybackLocation(value) {
    return (
      /^\/video\/BV[0-9A-Za-z]{10}(?:\/|$)/.test(value.pathname) ||
      /^\/list\/(?:watchlater|\d{4,12})(?:\/|$)/.test(value.pathname)
    );
  }
  function theme(settings) {
    const media = root.matchMedia || root.window?.matchMedia;
    return settings.appearance.theme === "system"
      ? media &&
        media.call(root.window || root, "(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : settings.appearance.theme;
  }
  function backup(settings) {
    return {
      format: "bilibili-codex-settings",
      version: 2,
      exportedAt: new Date().toISOString(),
      settings: normalize(settings),
    };
  }
  function restore(value) {
    if (value?.format !== "bilibili-codex-settings" || value.version !== 2)
      throw Error("不是本插件的配置备份。");
    return normalize(value.settings);
  }
  const api = {
    DEFAULTS,
    HIDDEN,
    CATALOG,
    normalize,
    get,
    set,
    matchVideo,
    parseShortcut,
    matchesShortcut,
    inDurationRange,
    isPlaybackLocation,
    theme,
    backup,
    restore,
  };
  root.BiliConfig = api;
  if (typeof module === "object") module.exports = api;
})(globalThis);
