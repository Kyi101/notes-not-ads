async function init() {
  registerExtensionListeners();
  startObserver();
  state.settings = await loadSettings();
  state.settingsReady = true;
  state.cosmeticRules = loadCosmeticRulesForPage();
  syncPageDnrAllowRule();

  if (!isPageAllowed(state.settings)) {
    stopObserver();
    return;
  }

  await runScan({ force: true });
  startWarmupScans();
}

function registerExtensionListeners() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== "string") {
      return false;
    }

    if (message.type === "AR_GET_STATUS") {
      sendResponse(getStatus());
      return false;
    }

    if (message.type === "AR_TOGGLE_INSPECTOR") {
      const inspectorStatus = toggleInspector();
      sendResponse({ ...getStatus(), ...inspectorStatus });
      return false;
    }

    if (message.type === "AR_REPLACE_NOW") {
      runScan({ force: true }).then((inserted) => {
        sendResponse({ ...getStatus(), insertedNow: inserted });
      });
      return true;
    }

    if (message.type === "AR_SETTINGS_CHANGED") {
      loadSettings().then((settings) => {
        state.settings = settings;
        syncPageDnrAllowRule();
        applySettingsToReplacedSlots();
        scheduleScan(80);
        sendResponse(getStatus());
      });
      return true;
    }

    return false;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[STORAGE_KEY]) {
      return;
    }

    state.settings = mergeSettings(changes[STORAGE_KEY].newValue);
    syncPageDnrAllowRule();
    applySettingsToReplacedSlots();
    scheduleScan(80);
  });
}

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (items) => {
      resolve(mergeSettings(items[STORAGE_KEY]));
    });
  });
}

function mergeSettings(value) {
  const stored = value && typeof value === "object" ? value : {};
  const legacyNotes = Array.isArray(stored.customNotes)
    ? stored.customNotes.map((note) => String(note || "").trim()).filter(Boolean)
    : [];
  const mode = ["quiet", "anchor"].includes(stored.mode)
    ? stored.mode
    : legacyNotes.length
      ? "anchor"
      : DEFAULT_SETTINGS.mode;
  const legacyPresence =
    stored.frequency === "max1" ? 3 : stored.frequency === "max3" ? 6 : 10;
  const visualPresence = Number.isFinite(Number(stored.visualPresence))
    ? Math.min(10, Math.max(0, Math.round(Number(stored.visualPresence))))
    : legacyPresence;

  return {
    enabled: stored.enabled !== false,
    mode,
    anchorNote:
      typeof stored.anchorNote === "string" && stored.anchorNote.trim()
        ? stored.anchorNote.trim()
        : legacyNotes[0] || DEFAULT_SETTINGS.anchorNote,
    visualPresence,
    reducedMotion: stored.reducedMotion === "still" ? "still" : "system",
    disabledDomains: Array.isArray(stored.disabledDomains)
      ? stored.disabledDomains
      : []
  };
}

function getStatus() {
  return {
    inserted: state.inserted,
    visualPresence: state.settings ? state.settings.visualPresence : 10,
    mode: state.settings ? state.settings.mode : "quiet",
    enabled: Boolean(state.settings && state.settings.enabled),
    pageAllowed: isPageAllowed(state.settings),
    inspectorActive: state.inspector.active,
    inspectorCandidateCount: state.inspector.candidates.length,
    domain: location.hostname
  };
}

function syncPageDnrAllowRule() {
  if (!chrome.runtime || typeof chrome.runtime.sendMessage !== "function") {
    return;
  }

  chrome.runtime.sendMessage({
    type: "AR_SYNC_PAGE_DNR_ALLOW",
    allow: !isPageAllowed(state.settings)
  });
}

function startObserver() {
  if (state.observer || !document.documentElement) {
    return;
  }

  state.observer = new MutationObserver((mutations) => {
    const hasPageMutation = mutations.some((mutation) => {
      return (
        !(mutation.target instanceof HTMLElement) ||
        !isExtensionElement(mutation.target)
      );
    });

    if (!hasPageMutation) {
      return;
    }

    scheduleScan(80);
  });

  state.observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "class",
      "style",
      "src",
      "data-src",
      "width",
      "height",
      "aria-label",
      "title"
    ]
  });
}

function stopObserver() {
  if (!state.observer) {
    return;
  }

  state.observer.disconnect();
  state.observer = null;
}

function startWarmupScans() {
  [500, 1500, 3500, 7000].forEach((delay) => {
    window.setTimeout(() => {
      runScan({ force: false });
    }, delay);
  });
}

function scheduleScan(delay) {
  const safeDelay = Math.max(0, Number(delay) || 0);
  const dueAt = performance.now() + safeDelay;

  if (state.scanTimer && state.scanDueAt <= dueAt) {
    return;
  }

  window.clearTimeout(state.scanTimer);
  state.scanDueAt = dueAt;
  state.scanTimer = window.setTimeout(() => {
    state.scanTimer = 0;
    state.scanDueAt = 0;
    window.requestAnimationFrame(() => {
      runScan({ force: false });
    });
  }, safeDelay);
}
