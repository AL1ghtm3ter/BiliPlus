(() => {
  "use strict";
  const F = BiliFeatures;
  F.register("layout", (settings, context) => {
    if (
      !BiliConfig.isPlaybackLocation(location) ||
      !settings.layout.rightComments
    )
      return () => {};
    const scope = new F.Scope();
    let shell,
      left,
      side,
      innerScope,
      playerNode,
      playerMarker,
      commentNode,
      commentMarker,
      stopped = false;
    const currentPlayer = () =>
      document.querySelector("#playerWrap") ||
      document.querySelector("#bilibili-player");
    const currentComments = () =>
      document.querySelector("#commentapp") ||
      document.querySelector(".comment-container") ||
      document.querySelector("bili-comments");
    function followPlayer(player) {
      if (!player) return;
      if (player !== playerNode && !left.contains(player)) {
        playerMarker?.remove();
        playerMarker = document.createComment("bili-player-original-location");
        player.before(playerMarker);
      }
      playerNode = player;
      if (player.parentNode !== left) left.append(player);
    }
    function followComments(comments) {
      if (!comments) return;
      if (comments !== commentNode && !side.contains(comments)) {
        commentMarker?.remove();
        commentMarker = document.createComment(
          "bili-comments-original-location",
        );
        comments.before(commentMarker);
      }
      commentNode = comments;
      if (comments.parentNode !== side) {
        side.replaceChildren();
        side.append(comments);
      }
    }
    function mount() {
      if (stopped) return;
      if (shell?.isConnected) {
        followPlayer(currentPlayer());
        followComments(currentComments());
        return;
      }
      const player = currentPlayer();
      if (!player?.parentElement) return;
      innerScope?.clean();
      innerScope = new F.Scope();
      shell = F.create("div", undefined, { "data-bcx-right-comments": "1" });
      left = F.create("div", undefined, { "data-bcx-player-column": "1" });
      side = F.create("aside", undefined, {
        "data-bcx-comment-column": "1",
        "aria-label": "评论",
      });
      const style = F.create("style");
      // Keep the native right rail (and its subtitle assistant) in the page's
      // layout. Only arrange the player and comments inside the left column.
      style.textContent =
        "[data-bcx-right-comments]{display:grid;gap:8px;width:100%;min-width:0}[data-bcx-player-column]{min-width:0}[data-bcx-comment-column]{min-width:0;max-height:80vh;overflow:auto;background:var(--bg1,#fff);border-radius:12px;padding:0 12px 16px}[data-bcx-comment-column] #commentapp{width:100%!important;margin:0!important}@media(max-width:1000px){[data-bcx-right-comments]{display:block}[data-bcx-right-comments]>[role=separator]{display:none}[data-bcx-comment-column]{margin-top:16px;max-height:70vh}}";
      innerScope.node(style);
      shell.style.gridTemplateColumns =
        "minmax(0,1fr) 8px minmax(280px,min(55vw," +
        settings.layout.commentWidthPx +
        "px))";
      player.before(shell);
      innerScope.disposers.push(() => shell.remove());
      const separator = F.create("div", undefined, {
        role: "separator",
        tabindex: "0",
        "aria-label": "调整右侧评论宽度",
        "aria-orientation": "vertical",
        "aria-valuemin": "300",
        "aria-valuemax": "800",
        "aria-valuenow": String(settings.layout.commentWidthPx),
      });
      separator.style.cssText =
        "cursor:col-resize;touch-action:none;border-radius:4px;background:var(--line_regular,#eee)";
      shell.append(left, separator, side);
      let dragging = false,
        width = settings.layout.commentWidthPx;
      innerScope.on(separator, "pointerdown", (event) => {
        dragging = true;
        separator.setPointerCapture?.(event.pointerId);
        event.preventDefault();
      });
      innerScope.on(window, "pointermove", (event) => {
        if (!dragging) return;
        width = Math.max(
          300,
          Math.min(800, shell.getBoundingClientRect().right - event.clientX),
        );
        shell.style.gridTemplateColumns = "minmax(0,1fr) 8px " + width + "px";
        separator.setAttribute("aria-valuenow", String(Math.round(width)));
      });
      innerScope.on(window, "pointerup", () => {
        if (!dragging) return;
        dragging = false;
        context.patch("layout.commentWidthPx", Math.round(width));
      });
      innerScope.on(separator, "keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.code)) return;
        event.preventDefault();
        width = Math.max(
          300,
          Math.min(800, width + (event.code === "ArrowLeft" ? 20 : -20)),
        );
        context.patch("layout.commentWidthPx", width);
      });
      playerNode = commentNode = null;
      followPlayer(player);
      followComments(currentComments());
      innerScope.disposers.push(() => {
        const player = currentPlayer(),
          comments = currentComments();
        if (player && left.contains(player)) playerNode = player;
        else if (player && player !== playerNode) playerNode = null;
        if (comments && side.contains(comments)) commentNode = comments;
        else if (comments && comments !== commentNode) commentNode = null;
        for (const [node, marker, owner] of [
          [playerNode, playerMarker, left],
          [commentNode, commentMarker, side],
        ]) {
          // Restore only nodes still owned here, including replacements or an
          // intact node whose extension container alone was detached.
          if (node && owner.contains(node)) {
            if (marker?.isConnected) marker.replaceWith(node);
            else if (shell.isConnected) shell.before(node);
          }
          marker?.remove();
        }
        playerMarker = commentMarker = null;
      });
      const timer = setTimeout(
        () => window.dispatchEvent(new Event("resize")),
        0,
      );
      innerScope.disposers.push(() => clearTimeout(timer));
    }
    mount();
    scope.interval(mount, 1200);
    scope.disposers.push(() => {
      stopped = true;
      innerScope?.clean();
      window.dispatchEvent(new Event("resize"));
    });
    return () => scope.clean();
  });
})();
