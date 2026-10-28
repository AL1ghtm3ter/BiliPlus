(() => {
  "use strict";
  const tracks = new Map();
  let currentPlayer = {};
  const details = new Map();
  const binarySubtitle = (url) =>
    url.hostname === "api.bilibili.com" &&
    /^\/x\/v2\/(?:subtitle|dm)\/web\/view$/.test(url.pathname);
  const commentEndpoint = (url) =>
    url.hostname === "api.bilibili.com" &&
    /^\/x\/v2\/reply\/(?:(?:wbi\/)?main|reply)$/.test(url.pathname);
  const jsonEndpoint = (url) =>
    url.hostname === "api.bilibili.com" &&
    (/^\/x\/player\/(?:wbi\/)?v2$/.test(url.pathname) ||
      url.pathname === "/x/web-interface/view" ||
      (videoMetadataEnabled &&
        /^\/x\/web-interface\/(?:(?:wbi\/)?index\/top\/feed\/(?:rcmd|rcmd_feed)|popular|(?:wbi\/)?search\/type)$/.test(
          url.pathname,
        )) ||
      (commentIpEnabled && commentEndpoint(url)));
  function requestAddress(input) {
    // Native fetch/open own WebIDL conversion. Observing a custom URL object
    // must not convert it a second time or stop the page request.
    try {
      if (typeof input === "string") return input;
      if (input instanceof URL) return input.href;
      if (typeof Request === "function" && input instanceof Request)
        return input.url;
    } catch {}
    return "";
  }
  function rememberTracks(cid, list) {
    if (!cid || !Array.isArray(list)) return;
    if (list.length || !tracks.get(cid)?.length) tracks.set(cid, list);
    if (tracks.size > 16) tracks.delete(tracks.keys().next().value);
  }
  function inspectBinary(raw, data) {
    try {
      const url = new URL(raw, location.href);
      if (!binarySubtitle(url)) return;
      rememberTracks(
        url.searchParams.get("oid"),
        BiliSubtitles.decodeSubtitleTracks(data, {
          legacyDm: url.pathname.includes("/dm/"),
        }),
      );
    } catch {}
  }
  let historyEnabled = false,
    commentIpEnabled = false,
    videoMetadataEnabled = false,
    lastFeed = null;
  const emit = (data) =>
    window.dispatchEvent(
      new CustomEvent("bili-codex-data", { detail: JSON.stringify(data) }),
    );
  const commentCache = new Map(),
    commentRequests = new Map(),
    commentRecovered = new Set();
  let commentPage = "",
    commentOid = "",
    commentEpoch = 0,
    commentRecoveries = 0,
    commentRecoveryError = "";
  function publishCommentDiagnostics() {
    if (commentIpEnabled)
      emit({
        commentIpDiagnostics: {
          recoveries: commentRecoveries,
          error: commentRecoveryError,
        },
      });
  }
  const pageIdentity = () =>
    location.pathname +
    (location.pathname.startsWith("/list/") ? location.search || "" : "");
  function syncCommentPage() {
    const next = pageIdentity();
    if (next !== commentPage) {
      commentPage = next;
      commentOid = "";
      commentEpoch++;
      commentCache.clear();
      commentRequests.clear();
      commentRecovered.clear();
      commentRecoveries = 0;
      commentRecoveryError = "";
    }
  }
  function rememberCommentRequest(url, method, requestPage) {
    if (!commentEndpoint(url) || method !== "GET") return;
    syncCommentPage();
    if (requestPage !== commentPage) return;
    const oid = url.searchParams.get("oid") || "";
    if (
      !/^\d+$/.test(oid) ||
      !["", "1"].includes(url.searchParams.get("type") || "")
    )
      return;
    if (commentOid && commentOid !== oid) {
      commentEpoch++;
      commentCache.clear();
      commentRequests.clear();
      commentRecovered.clear();
      commentRecoveries = 0;
      commentRecoveryError = "";
    }
    commentOid = oid;
    const key = oid + ":" + (url.searchParams.get("root") || "main");
    commentRequests.set(key, { key, url: url.href, page: commentPage, oid });
    while (commentRequests.size > 4)
      commentRequests.delete(commentRequests.keys().next().value);
  }
  function publishComments(comments) {
    if (comments.length) emit({ comments, commentPage, commentOid });
  }
  function inspectComments(url, data, requestPage) {
    if (!commentIpEnabled || !commentEndpoint(url) || data?.code !== 0) return;
    syncCommentPage();
    const oid = url.searchParams.get("oid") || "";
    if (requestPage !== commentPage || (commentOid && oid !== commentOid))
      return;
    const body = data?.data;
    if (!body || typeof body !== "object") return;
    commentRecoveryError = "";
    const queue = [
      ...(Array.isArray(body.replies) ? body.replies : []),
      ...(Array.isArray(body.top_replies) ? body.top_replies : []),
      body.top?.admin,
      body.top?.upper,
      body.top?.vote,
    ];
    const comments = [];
    let visited = 0;
    while (queue.length && visited++ < 5000 && comments.length < 1000) {
      const item = queue.shift();
      if (!item || typeof item !== "object") continue;
      const raw = item.reply_control?.location;
      const location =
        typeof raw === "string"
          ? raw
              .trim()
              .replace(/^IP\s*属地\s*[:：]\s*/u, "")
              .trim()
              .slice(0, 80)
          : "";
      const rpid = String(item.rpid_str ?? item.rpid ?? "");
      const uid = String(item.mid_str ?? item.mid ?? item.member?.mid ?? "");
      if (location && (/^\d+$/.test(rpid) || /^\d+$/.test(uid))) {
        const entry = { rpid, uid, location };
        comments.push(entry);
        commentCache.set(
          rpid ? "rpid:" + rpid : "uid:" + uid + ":" + location,
          entry,
        );
      }
      if (Array.isArray(item.replies)) queue.push(...item.replies);
    }
    while (commentCache.size > 2000)
      commentCache.delete(commentCache.keys().next().value);
    if (!commentOid) commentOid = oid;
    for (const request of commentRequests.values())
      if (request.url === url.href) commentRecovered.add(request.key);
    publishComments(comments);
    publishCommentDiagnostics();
  }
  function replayComments() {
    syncCommentPage();
    if (!commentIpEnabled) return;
    publishComments([...commentCache.values()]);
    publishCommentDiagnostics();
    for (const request of commentRequests.values()) {
      if (commentRecovered.has(request.key)) continue;
      commentRecovered.add(request.key);
      const epoch = commentEpoch;
      // Recovery only repeats a read-only comment GET already made by this
      // page. No URL, cookie, comment text or complete reply is sent to the
      // isolated world; only the API's public location mapping is retained.
      void Promise.resolve()
        .then(async () => {
          if (
            !commentIpEnabled ||
            epoch !== commentEpoch ||
            request.page !== pageIdentity()
          )
            return;
          commentRecoveries++;
          publishCommentDiagnostics();
          const response = await Reflect.apply(nativeFetch, window, [
            request.url,
            { method: "GET", credentials: "include" },
          ]);
          if (
            !commentIpEnabled ||
            epoch !== commentEpoch ||
            request.page !== pageIdentity()
          )
            return;
          if (response.ok === false) {
            commentRecoveryError = "HTTP_" + response.status;
            publishCommentDiagnostics();
            return;
          }
          const length = Number(response.headers?.get?.("content-length"));
          if (Number.isFinite(length) && length > 2e6) {
            commentRecoveryError = "RESPONSE_TOO_LARGE";
            publishCommentDiagnostics();
            return;
          }
          const text = await response.text();
          if (!commentIpEnabled || epoch !== commentEpoch) return;
          if (text.length > 2e6) {
            commentRecoveryError = "RESPONSE_TOO_LARGE";
            publishCommentDiagnostics();
            return;
          }
          const data = JSON.parse(text);
          if (typeof data?.code === "number" && data.code !== 0) {
            commentRecoveryError = "API_" + data.code;
            publishCommentDiagnostics();
            return;
          }
          inspectComments(new URL(request.url), data, request.page);
        })
        .catch((error) => {
          if (!commentIpEnabled || epoch !== commentEpoch) return;
          commentRecoveryError = [
            "AbortError",
            "SyntaxError",
            "TypeError",
          ].includes(error?.name)
            ? error.name
            : "Error";
          publishCommentDiagnostics();
        });
    }
  }
  const feedUrl = (url) =>
    url.hostname === "api.bilibili.com" &&
    /^\/x\/web-interface\/(?:wbi\/)?index\/top\/feed\/(?:rcmd|rcmd_feed)$/.test(
      url.pathname,
    );
  // fresh_type=3 replaces the top recommendations. Infinite-feed/preload
  // requests share this endpoint and must not exit a selected history batch.
  const refreshFeedUrl = (url) =>
    feedUrl(url) && url.searchParams.get("fresh_type") === "3";
  const itemsOf = (data) =>
    data?.data?.item || data?.data?.list || data?.data?.result || [];
  const bvid = (item) =>
    item?.bvid || String(item?.uri || "").match(/BV[0-9A-Za-z]{10}/)?.[0] || "";
  function observePlayer(rawUrl) {
    try {
      const url = new URL(rawUrl, location.href);
      const player = /^\/x\/player\/(wbi\/)?v2$/.test(url.pathname),
        subtitle = url.pathname === "/x/v2/subtitle/web/view",
        cid = url.searchParams.get(player ? "cid" : "oid");
      if (
        url.hostname === "api.bilibili.com" &&
        (player || subtitle) &&
        /^\d+$/.test(cid || "")
      ) {
        currentPlayer = {
          bvid:
            url.searchParams.get("bvid") ||
            (currentPlayer.cid === cid ? currentPlayer.bvid : "") ||
            "",
          aid: url.searchParams.get(player ? "aid" : "pid") || "",
          cid,
        };
        emit({ player: currentPlayer });
      }
    } catch {}
  }
  function cleanVideo(item) {
    let kind = "";
    const target = String(item?.goto || item?.type || "");
    if (/live/.test(target)) kind = "live";
    else if (/bangumi|pgc|season/.test(target)) kind = "bangumi";
    else if (/course|cheese/.test(target)) kind = "course";
    else if (/ad/.test(target) && target !== "av") kind = "ad";
    const numeric = (n) =>
      typeof n === "number" && Number.isFinite(n) ? n : undefined;
    return {
      bvid: bvid(item),
      uri: String(item?.uri || item?.url || "").slice(0, 1000),
      title: String(item?.title || "")
        .replace(/<[^>]*>/g, "")
        .slice(0, 500),
      author: String(item?.owner?.name || item?.author || "").slice(0, 120),
      authorId: String(item?.owner?.mid || item?.mid || ""),
      duration: numeric(item?.duration),
      plays: numeric(item?.stat?.view ?? item?.stat?.play ?? item?.play),
      likes: numeric(item?.stat?.like ?? item?.like),
      danmaku: numeric(item?.stat?.danmaku ?? item?.video_review),
      publishedAt: numeric(item?.pubdate ?? item?.pubtime),
      kind,
      isAd: !!item?.is_ad || !!item?.ad_info || kind === "ad",
      promoted:
        !!item?.creative_id ||
        !!item?.is_upower_exclusive ||
        !!item?.business_info,
    };
  }
  function inspect(
    rawUrl,
    data,
    isReplay = false,
    requestPage = pageIdentity(),
  ) {
    try {
      const url = new URL(rawUrl, location.href);
      if (url.hostname !== "api.bilibili.com") return;
      if (/^\/x\/player\/(wbi\/)?v2$/.test(url.pathname)) {
        const cid = url.searchParams.get("cid"),
          list = data?.data?.subtitle?.subtitles;
        rememberTracks(cid, list);
        if (cid && currentPlayer.cid === cid) {
          currentPlayer = {
            bvid: currentPlayer.bvid || data?.data?.bvid || "",
            aid: currentPlayer.aid || data?.data?.aid || "",
            cid,
          };
          emit({ player: currentPlayer });
        }
      }
      if (
        /\/web-interface\/(?:(?:wbi\/)?index\/top\/feed|popular|(?:wbi\/)?search\/type)/.test(
          url.pathname,
        )
      ) {
        const items = itemsOf(data);
        if (Array.isArray(items))
          emit({ videos: items.slice(0, 160).map(cleanVideo) });
        if (feedUrl(url) && !isReplay) {
          lastFeed = data;
          if (
            historyEnabled &&
            refreshFeedUrl(url) &&
            location.pathname === "/"
          )
            emit({ homeFeed: { phase: "response" } });
        }
      }
      if (/\/web-interface\/view$/.test(url.pathname) && data?.data) {
        if (data.data.bvid) {
          details.set(data.data.bvid, data.data);
          if (details.size > 30) details.delete(details.keys().next().value);
        }
        emit({ videos: [cleanVideo(data.data)] });
      }
      if (commentEndpoint(url)) inspectComments(url, data, requestPage);
    } catch {}
  }
  const nativeFetch = window.fetch;
  window.fetch = function (...args) {
    const raw = requestAddress(args[0]);
    const requestPage = pageIdentity();
    let url;
    try {
      if (raw) url = new URL(raw, location.href);
    } catch {}
    try {
      if (historyEnabled && url && refreshFeedUrl(url))
        emit({ homeFeed: { phase: "request" } });
    } catch {}
    const pending = Reflect.apply(nativeFetch, this, args);
    try {
      if (url) {
        const method =
          args[1]?.method ||
          (typeof Request === "function" && args[0] instanceof Request
            ? args[0].method
            : "GET");
        if (typeof method === "string")
          rememberCommentRequest(url, method.toUpperCase(), requestPage);
      }
      observePlayer(raw);
      if (url && (binarySubtitle(url) || jsonEndpoint(url)))
        pending
          .then((response) =>
            binarySubtitle(url)
              ? response
                  .clone()
                  .arrayBuffer()
                  .then((data) => inspectBinary(raw, data))
                  .catch(() => {})
              : jsonEndpoint(url)
                ? response
                    .clone()
                    .json()
                    .then((data) => inspect(raw, data, false, requestPage))
                    .catch(() => {})
                : undefined,
          )
          .catch(() => {});
    } catch {}
    return pending;
  };
  const open = XMLHttpRequest.prototype.open,
    send = XMLHttpRequest.prototype.send,
    urls = new WeakMap(),
    methods = new WeakMap();
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    const result = Reflect.apply(open, this, [method, url, ...rest]);
    urls.set(this, requestAddress(url));
    methods.set(this, typeof method === "string" ? method.toUpperCase() : "");
    return result;
  };
  XMLHttpRequest.prototype.send = function (...args) {
    const url = urls.get(this) || "";
    const requestPage = pageIdentity();
    try {
      const target = url ? new URL(url, location.href) : null;
      if (target && historyEnabled && refreshFeedUrl(target))
        emit({ homeFeed: { phase: "request" } });
      if (target)
        rememberCommentRequest(target, methods.get(this), requestPage);
      if (target && (binarySubtitle(target) || jsonEndpoint(target)))
        this.addEventListener(
          "load",
          () => {
            try {
              if (binarySubtitle(target)) {
                if (this.responseType === "arraybuffer")
                  inspectBinary(url, this.response);
                else if (this.responseType === "blob")
                  this.response
                    .arrayBuffer()
                    .then((data) => inspectBinary(url, data))
                    .catch(() => {});
                return;
              }
              if (
                !jsonEndpoint(target) ||
                (this.responseType && this.responseType !== "json")
              )
                return;
              inspect(
                url,
                this.responseType === "json"
                  ? this.response
                  : JSON.parse(this.responseText),
                false,
                requestPage,
              );
            } catch {}
          },
          { once: true },
        );
    } catch {}
    const result = Reflect.apply(send, this, args);
    observePlayer(url);
    return result;
  };
  let seedTimer,
    seedAttempts = 0;
  function seedFeed() {
    const initial = window.__pinia?.feed?.data?.recommend?.item;
    const items = itemsOf(lastFeed).length ? itemsOf(lastFeed) : initial;
    if (Array.isArray(items) && items.length) {
      const payload = { code: 0, data: { item: items } };
      emit({ videos: items.slice(0, 160).map(cleanVideo) });
      if (!lastFeed) lastFeed = payload;

      return;
    }
    if (location.pathname === "/" && seedAttempts++ < 12)
      seedTimer = setTimeout(seedFeed, 500);
  }
  window.addEventListener("bili-codex-config", (event) => {
    try {
      const data = JSON.parse(event.detail);
      historyEnabled = data.history === true;
      const previousCommentIp = commentIpEnabled;
      commentIpEnabled = data.commentIp === true;
      if (!commentIpEnabled) {
        commentEpoch++;
        commentCache.clear();
        commentRecovered.clear();
        commentRecoveries = 0;
        commentRecoveryError = "";
      } else if (!previousCommentIp) commentRecovered.clear();
      videoMetadataEnabled = data.videoMetadata === true || historyEnabled;
      replayComments();

      clearTimeout(seedTimer);
      seedAttempts = 0;
      seedFeed();
    } catch {}
  });
  window.addEventListener("bili-codex-request", (event) => {
    try {
      const request = JSON.parse(event.detail);
      if (typeof request.id !== "string" || request.id.length > 80) return;
      const pageUrl = new URL(location.href),
        playlist = /^\/list\//.test(location.pathname),
        expected = playlist
          ? currentPlayer.bvid ||
            (currentPlayer.aid ? "" : pageUrl.searchParams.get("bvid"))
          : location.pathname.match(/\/video\/(BV[0-9A-Za-z]{10})/)?.[1];
      const original = window.__INITIAL_STATE__?.videoData;
      const usable =
        original &&
        (!expected || original.bvid === expected) &&
        (!playlist ||
          !currentPlayer.aid ||
          String(original.aid) === String(currentPlayer.aid));
      let data = details.get(expected) || (usable ? original : null);
      if (
        playlist &&
        currentPlayer.cid &&
        data &&
        !data.pages?.some((page) => String(page.cid) === currentPlayer.cid) &&
        String(data.cid) !== currentPlayer.cid
      )
        data = null;
      const p = Number(pageUrl.searchParams.get("p") || 1),
        page =
          (playlist
            ? data?.pages?.find(
                (page) => String(page.cid) === String(currentPlayer.cid),
              )
            : null) || data?.pages?.[p - 1],
        cid = playlist
          ? currentPlayer.cid || page?.cid || data?.cid
          : page?.cid || data?.cid;
      window.dispatchEvent(
        new CustomEvent("bili-codex-snapshot", {
          detail: JSON.stringify({
            id: request.id,
            bvid: playlist ? currentPlayer.bvid || data?.bvid : data?.bvid,
            aid: currentPlayer.aid || data?.aid,
            cid,
            title:
              page?.part && data?.videos > 1
                ? data.title + " · " + page.part
                : data?.title,
            duration:
              playlist && !data?.bvid ? 0 : page?.duration || data?.duration,
            tracks: tracks.get(String(cid)) || [],
          }),
        }),
      );
    } catch {}
  });
})();
