(() => {
  const INSTALLED_KEY = "__attentionRedirectorYoutubePruneInstalled";
  const PRUNE_KEYS = new Set(["adPlacements", "adSlots", "playerAds"]);
  const PLAYER_PATHS = new Set(["/youtubei/v1/player", "/player"]);
  const state = { enabled: true };
  const managedStyles = [];
  let prunedGlobalObjects = new WeakSet();
  let globalPruneTimer = 0;

  if (window[INSTALLED_KEY] || !isYoutubeHost(location.hostname)) {
    return;
  }
  window[INSTALLED_KEY] = true;

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }

    const data = event.data;
    if (
      !data ||
      data.source !== "attention-redirector" ||
      data.type !== "AR_YOUTUBE_PRUNE_CONFIG"
    ) {
      return;
    }

    state.enabled = data.enabled === true;
    managedStyles.forEach((style) => {
      style.disabled = !state.enabled;
    });
  });

  patchFetch();
  patchXmlHttpRequest();
  startGlobalPruneLoop();
  startAdSuppressionLoop();

  function patchFetch() {
    if (typeof window.fetch !== "function") {
      return;
    }

    const nativeFetch = window.fetch;
    window.fetch = async function attentionRedirectorFetch(input, init) {
      const response = await nativeFetch.apply(this, arguments);
      if (!state.enabled || !shouldPruneUrl(getFetchUrl(input, response.url))) {
        return response;
      }

      return pruneResponse(response);
    };
  }

  function patchXmlHttpRequest() {
    if (typeof window.XMLHttpRequest !== "function") {
      return;
    }

    const proto = window.XMLHttpRequest.prototype;
    const nativeOpen = proto.open;
    const nativeSend = proto.send;
    const responseTextGetter =
      Object.getOwnPropertyDescriptor(proto, "responseText")?.get;

    if (typeof nativeOpen !== "function" || typeof nativeSend !== "function") {
      return;
    }

    proto.open = function attentionRedirectorOpen(method, url) {
      this.__attentionRedirectorYoutubePruneUrl = resolveUrl(url);
      return nativeOpen.apply(this, arguments);
    };

    proto.send = function attentionRedirectorSend() {
      const targetUrl = this.__attentionRedirectorYoutubePruneUrl;
      if (responseTextGetter && shouldPruneUrl(targetUrl)) {
        this.addEventListener(
          "readystatechange",
          () => {
            if (!state.enabled || this.readyState !== 4) {
              return;
            }

            if (this.responseType && this.responseType !== "text") {
              return;
            }

            let rawText = "";
            try {
              rawText = responseTextGetter.call(this);
            } catch (_error) {
              return;
            }

            const prunedText = pruneText(rawText);
            if (prunedText === rawText) {
              return;
            }

            Object.defineProperty(this, "responseText", {
              configurable: true,
              get() {
                return prunedText;
              }
            });
            Object.defineProperty(this, "response", {
              configurable: true,
              get() {
                return prunedText;
              }
            });
          },
          true
        );
      }

      return nativeSend.apply(this, arguments);
    };
  }

  async function pruneResponse(response) {
    let rawText = "";
    try {
      rawText = await response.clone().text();
    } catch (_error) {
      return response;
    }

    const prunedText = pruneText(rawText);
    if (prunedText === rawText) {
      return response;
    }

    const prunedJson = safeJsonParse(prunedText);
    response.text = () => Promise.resolve(prunedText);
    if (prunedJson !== null) {
      response.json = () => Promise.resolve(prunedJson);
    }
    return response;
  }

  function pruneText(rawText) {
    if (
      !state.enabled ||
      typeof rawText !== "string" ||
      !/(adPlacements|adSlots|playerAds)/.test(rawText)
    ) {
      return rawText;
    }

    try {
      const parsed = safeJsonParse(rawText);
      if (parsed === null) {
        return rawText;
      }
      return pruneValue(parsed) ? JSON.stringify(parsed) : rawText;
    } catch (_error) {
      return rawText;
    }
  }

  function startGlobalPruneLoop() {
    const runBurst = () => {
      window.clearTimeout(globalPruneTimer);
      let attempts = 0;

      const pruneGlobals = () => {
        pruneGlobalValue(window.ytInitialPlayerResponse);
        pruneGlobalValue(window.playerResponse);
        attempts += 1;
        if (attempts < 10) {
          globalPruneTimer = window.setTimeout(pruneGlobals, 250);
        }
      };

      pruneGlobals();
    };

    const resetAndRunBurst = () => {
      prunedGlobalObjects = new WeakSet();
      runBurst();
    };

    runBurst();
    window.addEventListener("yt-navigate-start", resetAndRunBurst);
    window.addEventListener("yt-navigate-finish", resetAndRunBurst);
    window.addEventListener("yt-page-data-updated", resetAndRunBurst);
    window.addEventListener("popstate", resetAndRunBurst);
  }

  function pruneGlobalValue(value) {
    if (!state.enabled || !value || typeof value !== "object") {
      return false;
    }

    if (prunedGlobalObjects.has(value)) {
      return false;
    }

    prunedGlobalObjects.add(value);
    return pruneValue(value);
  }

  function startAdSuppressionLoop() {
    const skipSelectors = [
      ".ytp-ad-skip-button-modern",
      ".ytp-ad-skip-button",
      ".ytp-skip-ad-button",
      ".ytp-ad-overlay-close-button"
    ];
    const adCss = [
      "#player-ads",
      "#masthead-ad",
      ".video-ads",
      ".ytp-ad-module",
      ".ytp-ad-player-overlay",
      ".ytp-ad-overlay-container",
      ".ytp-ad-companion-slot",
      "#companion",
      "ytd-companion-slot-renderer",
      "ytd-action-companion-ad-renderer",
      "ytd-ad-slot-renderer",
      "ytd-display-ad-renderer",
      "ytd-in-feed-ad-layout-renderer",
      "ytd-promoted-sparkles-web-renderer",
      "ytd-compact-promoted-video-renderer",
      "ytd-promoted-video-renderer"
    ].join(",");
    const skipState = {
      active: false,
      muted: false,
      playbackRate: 1,
      adTicks: 0,
      reloadHref: "",
      reloadAttempts: 0,
      lastReloadAt: 0
    };

    injectStyle(adCss);

    const tick = () => {
      let nextDelay = 900;

      if (!state.enabled || document.visibilityState === "hidden") {
        restoreVideo(skipState);
        skipState.adTicks = 0;
        window.setTimeout(tick, document.visibilityState === "hidden" ? 2500 : nextDelay);
        return;
      }

      const player = document.querySelector("#movie_player");
      const adShowing = Boolean(player?.classList.contains("ad-showing"));
      if (!adShowing) {
        restoreVideo(skipState);
        skipState.adTicks = 0;
        window.setTimeout(tick, nextDelay);
        return;
      }

      nextDelay = 120;
      skipState.adTicks += 1;
      clickSkipControls(skipSelectors);
      suppressAdVideo(skipState);
      recoverStuckAdPlayer(skipState);
      window.setTimeout(tick, nextDelay);
    };

    tick();
  }

  function injectStyle(selectorList) {
    const style = document.createElement("style");
    style.textContent = `${selectorList}{display:none!important;visibility:hidden!important;pointer-events:none!important;}`;
    style.disabled = !state.enabled;
    managedStyles.push(style);
    (document.documentElement || document.head || document).append(style);
  }

  function clickSkipControls(selectors) {
    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((button) => {
        if (button instanceof HTMLElement) {
          button.click();
        }
      });
    });
  }

  function suppressAdVideo(skipState) {
    const video = document.querySelector("video");
    if (!(video instanceof HTMLVideoElement)) {
      return;
    }

    if (!skipState.active) {
      skipState.active = true;
      skipState.muted = video.muted;
      skipState.playbackRate = video.playbackRate || 1;
    }

    video.muted = true;
    video.playbackRate = Math.max(video.playbackRate || 1, 16);

    if (Number.isFinite(video.duration) && video.duration > 0) {
      try {
        video.currentTime = Math.max(video.currentTime, video.duration - 0.05);
      } catch (_error) {
        // Some media streams reject seeking; skip buttons still cover skippable ads.
      }
    }
  }

  function recoverStuckAdPlayer(skipState) {
    const video = document.querySelector("video");
    const hasPlayableVideo =
      video instanceof HTMLVideoElement &&
      video.readyState > 0 &&
      Number.isFinite(video.duration) &&
      video.duration > 0;

    if (hasPlayableVideo || skipState.adTicks < 12) {
      return;
    }

    const href = location.href;
    if (skipState.reloadHref !== href) {
      skipState.reloadHref = href;
      skipState.reloadAttempts = 0;
      skipState.lastReloadAt = 0;
    }

    const now = Date.now();
    if (skipState.reloadAttempts >= 2 || now - skipState.lastReloadAt < 6000) {
      return;
    }

    const videoId = new URL(location.href).searchParams.get("v");
    const player = document.querySelector("#movie_player");
    if (!videoId || !player || typeof player.loadVideoById !== "function") {
      return;
    }

    skipState.reloadAttempts += 1;
    skipState.lastReloadAt = now;
    try {
      player.loadVideoById(videoId);
      if (typeof player.playVideo === "function") {
        player.playVideo();
      }
    } catch (_error) {
      // If YouTube changes this API, the normal skip/fast-forward path remains.
    }
  }

  function restoreVideo(skipState) {
    if (!skipState.active) {
      return;
    }

    const video = document.querySelector("video");
    if (video instanceof HTMLVideoElement) {
      video.muted = skipState.muted;
      video.playbackRate = skipState.playbackRate;
    }

    skipState.active = false;
  }

  function safeJsonParse(value) {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return null;
    }
  }

  function pruneValue(value, seen = new WeakSet()) {
    if (!state.enabled || !value || typeof value !== "object") {
      return false;
    }

    if (seen.has(value)) {
      return false;
    }
    seen.add(value);

    let changed = false;

    if (Array.isArray(value)) {
      value.forEach((item) => {
        changed = pruneValue(item, seen) || changed;
      });
      return changed;
    }

    PRUNE_KEYS.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        delete value[key];
        changed = true;
      }
    });

    Object.keys(value).forEach((key) => {
      changed = pruneValue(value[key], seen) || changed;
    });

    return changed;
  }

  function shouldPruneUrl(value) {
    if (!value) {
      return false;
    }

    let url;
    try {
      url = new URL(value, location.href);
    } catch (_error) {
      return false;
    }

    return isYoutubeHost(url.hostname) && PLAYER_PATHS.has(url.pathname);
  }

  function getFetchUrl(input, fallbackUrl) {
    if (typeof input === "string") {
      return resolveUrl(input);
    }

    if (input instanceof URL) {
      return input.href;
    }

    if (input && typeof input.url === "string") {
      return input.url;
    }

    return fallbackUrl || "";
  }

  function resolveUrl(value) {
    try {
      return new URL(String(value || ""), location.href).href;
    } catch (_error) {
      return "";
    }
  }

  function isYoutubeHost(hostname) {
    const host = hostname.toLowerCase();
    return host === "www.youtube.com" || host === "m.youtube.com" || host === "music.youtube.com";
  }
})();
