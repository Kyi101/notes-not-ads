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

    if (message.type === "AR_START_MISSED_AD_REPORT") {
      const inspectorStatus = startMissedAdReport();
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
    anchorNotes: normalizeAnchorNotes(
      stored.anchorNotes,
      stored.anchorNote,
      legacyNotes
    ),
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

  window.clearTimeout(state.dnrAllowSync.timer);

  chrome.runtime.sendMessage({
    type: "AR_SYNC_PAGE_DNR_ALLOW",
    allow: !isPageAllowed(state.settings)
  }, (response) => {
    const error = chrome.runtime.lastError;
    if (!error && response && response.ok) {
      state.dnrAllowSync.nextAttempt = 0;
      return;
    }

    if (state.dnrAllowSync.nextAttempt >= 3) {
      state.dnrAllowSync.nextAttempt = 0;
      return;
    }

    state.dnrAllowSync.nextAttempt += 1;
    state.dnrAllowSync.timer = window.setTimeout(() => {
      syncPageDnrAllowRule();
    }, state.dnrAllowSync.nextAttempt * 180);
  });
}

const PAGE_OBSERVER_OPTIONS = {
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
};

function startObserver() {
  if (state.observer || !document.documentElement) {
    return;
  }

  state.observer = new MutationObserver(handlePageMutations);
  observeScanRoot(document.documentElement);

  collectOpenShadowRoots(document).forEach((root) => {
    observeScanRoot(root);
  });
}

function stopObserver() {
  if (!state.observer) {
    return;
  }

  state.observer.disconnect();
  state.observer = null;
  state.observedScanRoots = new WeakSet();
}

function handlePageMutations(mutations) {
  let queuedScan = false;

  for (const mutation of mutations) {
    const target = mutation.target;

    if (mutation.type === "childList") {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement) || isExtensionElement(node)) {
          continue;
        }

        queuedScan = queueScanContext(node) || queuedScan;
      }
      continue;
    }

    if (
      mutation.type === "attributes" &&
      target instanceof HTMLElement &&
      !isExtensionElement(target)
    ) {
      queuedScan = queueScanContext(target) || queuedScan;
    }
  }

  if (queuedScan) {
    scheduleScan(80);
  }
}

function queueScanContext(node) {
  const context = normalizeScanContext(node);
  if (!context) {
    return false;
  }

  state.pendingScanNodes.add(context);

  if (context instanceof HTMLElement) {
    const root = getContainingOpenShadowRoot(context);
    if (root) {
      ensureShadowRootStyles(root);
    }
  }

  collectOpenShadowRoots(context).forEach((root) => {
    observeScanRoot(root);
    state.pendingScanNodes.add(root);
  });

  return true;
}

function observeScanRoot(root) {
  const target = normalizeObservableRoot(root);
  if (!state.observer || !target || state.observedScanRoots.has(target)) {
    return false;
  }

  state.observedScanRoots.add(target);
  if (isOpenShadowRoot(target)) {
    ensureShadowRootStyles(target);
    state.pendingScanNodes.add(target);
  }

  state.observer.observe(target, PAGE_OBSERVER_OPTIONS);
  return true;
}

function expandScanContexts(contextNodes = [document]) {
  const contexts = [];
  const seen = new Set();

  const addContext = (context) => {
    const normalized = normalizeScanContext(context);
    if (!normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    contexts.push(normalized);

    if (isOpenShadowRoot(normalized)) {
      ensureShadowRootStyles(normalized);
      observeScanRoot(normalized);
    }

    collectOpenShadowRoots(normalized).forEach(addContext);
  };

  contextNodes.forEach(addContext);
  return contexts.length ? contexts : [document];
}

function queryAllScanRoots(selector) {
  const matches = [];
  const seen = new Set();

  expandScanContexts([document]).forEach((context) => {
    const addMatch = (element) => {
      if (element instanceof HTMLElement && !seen.has(element)) {
        seen.add(element);
        matches.push(element);
      }
    };

    if (context instanceof HTMLElement) {
      try {
        if (context.matches(selector)) {
          addMatch(context);
        }
      } catch (_error) {}
    }

    if (typeof context.querySelectorAll === "function") {
      try {
        context.querySelectorAll(selector).forEach(addMatch);
      } catch (_error) {}
    }
  });

  return matches;
}

function collectOpenShadowRoots(context, maxRoots = 80) {
  const roots = [];
  const seen = new Set();

  const addRoot = (root) => {
    if (!isOpenShadowRoot(root) || seen.has(root) || roots.length >= maxRoots) {
      return;
    }

    seen.add(root);
    roots.push(root);
    ensureShadowRootStyles(root);
    visitTree(root);
  };

  const visitElement = (element) => {
    if (
      element instanceof HTMLElement &&
      !isExtensionElement(element) &&
      element.shadowRoot
    ) {
      addRoot(element.shadowRoot);
    }
  };

  const visitTree = (rootNode) => {
    const walkerRoot =
      rootNode === document ? document.documentElement : normalizeScanContext(rootNode);
    if (!walkerRoot || roots.length >= maxRoots) {
      return;
    }

    if (walkerRoot instanceof HTMLElement) {
      visitElement(walkerRoot);
    }

    const walker = document.createTreeWalker(
      walkerRoot,
      NodeFilter.SHOW_ELEMENT
    );
    let current = walker.nextNode();
    while (current && roots.length < maxRoots) {
      if (current instanceof HTMLElement) {
        visitElement(current);
      }
      current = walker.nextNode();
    }
  };

  visitTree(context);
  return roots;
}

function normalizeObservableRoot(node) {
  if (node === document) {
    return document.documentElement;
  }

  if (node instanceof HTMLElement || isOpenShadowRoot(node)) {
    return node;
  }

  return null;
}

function normalizeScanContext(node) {
  if (node === document || node instanceof HTMLElement || isOpenShadowRoot(node)) {
    return node;
  }

  return null;
}

function isOpenShadowRoot(node) {
  return (
    typeof ShadowRoot === "function" &&
    node instanceof ShadowRoot &&
    node.mode === "open"
  );
}

function getContainingOpenShadowRoot(element) {
  if (!(element instanceof HTMLElement) || typeof element.getRootNode !== "function") {
    return null;
  }

  const root = element.getRootNode();
  return isOpenShadowRoot(root) ? root : null;
}

function ensureShadowRootStyles(root) {
  if (!isOpenShadowRoot(root) || state.shadowStyleRoots.has(root)) {
    return;
  }

  const style = document.createElement("style");
  style.className = "attention-redirector-style";
  style.textContent = SHADOW_ROOT_STYLE_TEXT;
  root.append(style);
  state.shadowStyleRoots.add(root);
}

function closestAcrossRoots(element, selector) {
  let current = element;

  while (current instanceof HTMLElement) {
    const match = current.closest(selector);
    if (match) {
      return match;
    }

    const root = getContainingOpenShadowRoot(current);
    current = root && root.host instanceof HTMLElement ? root.host : null;
  }

  return null;
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

    const contextNodes =
      state.pendingScanNodes && state.pendingScanNodes.size > 0
        ? Array.from(state.pendingScanNodes)
        : [document];

    if (state.pendingScanNodes) {
      state.pendingScanNodes.clear();
    }

    window.requestAnimationFrame(() => {
      runScan({ force: false, contextNodes });
    });
  }, safeDelay);
}
