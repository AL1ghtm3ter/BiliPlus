(function (root) {
  "use strict";
  const notes = [
    "先把这一段看懂，再继续往后。",
    "把有用的信息留下，把多余的干扰关掉。",
    "今天只需要比昨天多理解一个问题。",
    "看完之后，用自己的话再讲一遍。",
    "问题越具体，答案越有帮助。",
    "给重要的内容留一点思考时间。",
    "学会一个方法，也别忘了它适用的条件。",
  ];
  function dailyNote(date = new Date()) {
    const day = Math.floor(
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000,
    );
    return notes[day % notes.length];
  }
  function applyTheme(document, settings) {
    document.documentElement.setAttribute(
      "data-theme",
      root.BiliConfig.theme(settings),
    );
  }
  function validateBackground(value) {
    if (
      !value ||
      typeof value.dataUrl !== "string" ||
      value.dataUrl.length > 3 * 1024 * 1024 ||
      !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(
        value.dataUrl,
      )
    )
      throw Error("本地背景图片格式无效或超过 3MB。");
    return {
      dataUrl: value.dataUrl,
      name: String(value.name || "本地图片").slice(0, 160),
      type: String(value.type || "image/webp"),
      width: Number(value.width) || 0,
      height: Number(value.height) || 0,
      originalSize: Number(value.originalSize) || 0,
      storedSize: value.dataUrl.length,
      updatedAt: Number(value.updatedAt) || Date.now(),
    };
  }
  async function prepareImage(file) {
    if (
      !file ||
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 16 * 1024 * 1024
    )
      throw Error("请选择 16MB 以内的 PNG、JPEG 或 WebP 图片。");
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (
        !image.naturalWidth ||
        image.naturalWidth * image.naturalHeight > 40e6
      )
        throw Error("图片尺寸过大，请先缩小图片。");
      const scale = Math.min(
          1,
          1920 / image.naturalWidth,
          1200 / image.naturalHeight,
        ),
        canvas = document.createElement("canvas");
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      canvas
        .getContext("2d")
        .drawImage(image, 0, 0, canvas.width, canvas.height);
      return validateBackground({
        dataUrl: canvas.toDataURL("image/webp", 0.86),
        name: file.name,
        type: "image/webp",
        width: canvas.width,
        height: canvas.height,
        originalSize: file.size,
        updatedAt: Date.now(),
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const api = { dailyNote, applyTheme, validateBackground, prepareImage };
  root.BiliUI = api;
  if (typeof module === "object") module.exports = api;
})(globalThis);
