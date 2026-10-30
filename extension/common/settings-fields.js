(function (root) {
  "use strict";
  const field = (key, label, options = {}) => ({
    key,
    label,
    type: "number",
    ...options,
  });
  const FIELDS = {
    player: [
      field("player.speed", "默认倍速", { min: 0.1, max: 5, step: 0.1 }),
      field("player.step", "快捷键步进", { min: 0.05, max: 2, step: 0.05 }),
      field("player.presets", "常用倍速", {
        type: "text",
        list: true,
        hint: "逗号分隔，范围 0.1–5。",
      }),
      field("player.speedUpShortcut", "加速快捷键", {
        type: "text",
        hint: "例如 Alt+ArrowUp 或 Ctrl+KeyQ。留空禁用，输入框内不触发。",
      }),
      field("player.speedDownShortcut", "减速快捷键", { type: "text" }),
      field("player.presetShortcuts", "直接选速快捷键", {
        type: "text",
        list: true,
        hint: "例如 Shift+1, Shift+2，需与下方倍速数量一致。",
      }),
      field("player.shortcutRates", "快捷键对应倍速", {
        type: "text",
        list: true,
      }),
      field("home.previewDelay", "卡片悬停等待（毫秒）", {
        min: 200,
        max: 3000,
        step: 50,
      }),
      field("home.historyLimit", "首页历史批次数", { min: 2, max: 12 }),
      field("home.thresholdMultiplier", "距页底多少屏时提前加载", {
        min: 0.5,
        max: 5,
        step: 0.5,
      }),
      field("home.unlockTimeoutMs", "推荐加载超时（毫秒）", {
        min: 1000,
        max: 30000,
      }),
      field("home.maxConsecutiveTimeouts", "连续超时多少次后冷却", {
        min: 1,
        max: 8,
      }),
      field("home.cooldownMs", "加载冷却时间（毫秒）", {
        min: 3000,
        max: 120000,
      }),
    ],
    layout: [
      field("layout.commentWidthPx", "右侧评论宽度（像素）", {
        min: 300,
        max: 800,
      }),
      field("home.backgroundSource", "极简首页背景来源", {
        type: "select",
        choices: [
          ["url", "图片地址"],
          ["local", "本地图片"],
        ],
      }),
      field("home.backgroundUrl", "极简首页背景图地址", {
        type: "url",
        hint: "HTTPS 图片地址；留空使用默认背景。",
      }),
    ],
    filter: [
      field("filter.titleKeywords", "标题关键词", {
        type: "textarea",
        list: true,
        hint: "每行一个，任一关键词匹配即隐藏，忽略大小写。",
      }),
      field("filter.authorNames", "作者名称黑名单", {
        type: "textarea",
        list: true,
        hint: "每行一个，完整名称匹配。",
      }),
      field("filter.authorIds", "作者 UID 黑名单", {
        type: "textarea",
        list: true,
      }),
      field("filter.publishedAfter", "发布日期不早于", { type: "date" }),
      field("filter.publishedBefore", "发布日期不晚于", { type: "date" }),
      field("filter.labelKinds", "特殊类型", {
        type: "text",
        list: true,
        hint: "live（直播）、bangumi（番剧/综艺）、course（课程）。",
      }),
    ],
    appearance: [
      field("appearance.theme", "界面主题", {
        type: "select",
        choices: [
          ["system", "跟随系统"],
          ["light", "浅色"],
          ["dark", "深色"],
        ],
      }),
      field("appearance.dailyQuoteEnabled", "弹窗显示每日一语", {
        type: "checkbox",
        hint: "文字保存在本地，不依赖每日一句服务。",
      }),
    ],
  };
  for (const [name, label] of [
    ["Duration", "时长（秒）"],
    ["Plays", "播放量"],
    ["Likes", "点赞量"],
    ["Danmaku", "弹幕数"],
    ["LikeRate", "点赞率（%）"],
  ])
    for (const [edge, word] of [
      ["min", "下限"],
      ["max", "上限"],
    ])
      FIELDS.filter.push(
        field("filter." + edge + name, label + word, {
          min: 0,
          ...(name === "LikeRate" ? { max: 100, step: 0.1 } : {}),
          hint: "0 表示不限制；未取得该字段时不会按它过滤。",
        }),
      );
  root.BiliSettingsFields = FIELDS;
  if (typeof module === "object") module.exports = FIELDS;
})(globalThis);
