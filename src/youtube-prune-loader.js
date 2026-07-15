(() => {
  const STORAGE_KEY = "attentionRedirectorSettings";
  const MAIN_SCRIPT = "src/youtube-prune-main.js";

  if (!isYoutubeHost(location.hostname)) {
    return;
  }

  let injected = false;
  let lastAllowed = false;

  chrome.storage.local.get(STORAGE_KEY, (items) => {
    const settings = mergeSettings(items[STORAGE_KEY]);
    lastAllowed = isAllowed(settings);
    if (lastAllowed) {
      injectMainWorldScript();
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[STORAGE_KEY]) {
      return;
    }

    const settings = mergeSettings(changes[STORAGE_KEY].newValue);
    lastAllowed = isAllowed(settings);
    if (lastAllowed) {
      injectMainWorldScript();
    }
    postConfig(lastAllowed);
  });

  function injectMainWorldScript() {
    if (injected) {
      postConfig(lastAllowed);
      return;
    }

    const parent = document.documentElement || document.head;
    if (!parent) {
      document.addEventListener("readystatechange", injectMainWorldScript, {
        once: true
      });
      return;
    }

    injected = true;
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL(MAIN_SCRIPT);
    script.async = false;
    script.onload = () => {
      postConfig(lastAllowed);
      script.remove();
    };
    parent.append(script);
  }

  function postConfig(enabled) {
    window.postMessage(
      {
        source: "attention-redirector",
        type: "AR_YOUTUBE_PRUNE_CONFIG",
        enabled: enabled === true
      },
      "*"
    );
  }

  function mergeSettings(value) {
    const stored = value && typeof value === "object" ? value : {};
    return {
      enabled: stored.enabled !== false,
      disabledDomains: Array.isArray(stored.disabledDomains)
        ? stored.disabledDomains
        : []
    };
  }

  function isAllowed(settings) {
    return (
      settings.enabled !== false &&
      !isDomainDisabled(location.hostname, settings.disabledDomains)
    );
  }

  function isDomainDisabled(hostname, disabledDomains) {
    const host = stripWww(hostname.toLowerCase());
    return disabledDomains.some((domain) => {
      const normalized = normalizeDomain(domain);
      return normalized && (host === normalized || host.endsWith(`.${normalized}`));
    });
  }

  function normalizeDomain(value) {
    const raw = String(value || "")
      .trim()
      .toLowerCase();

    if (!raw) {
      return "";
    }

    try {
      return stripWww(new URL(raw.includes("://") ? raw : `https://${raw}`).hostname);
    } catch (_error) {
      return stripWww(raw.split("/")[0]);
    }
  }

  function stripWww(hostname) {
    return hostname.replace(/^www\./, "");
  }

  function isYoutubeHost(hostname) {
    const host = hostname.toLowerCase();
    return host === "www.youtube.com" || host === "m.youtube.com" || host === "music.youtube.com";
  }
})();
