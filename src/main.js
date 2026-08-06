async function init() {
  registerExtensionListeners();
  state.settings = await loadSettings();
  state.settingsReady = true;
  state.cosmeticRules = loadCosmeticRulesForPage();
  state.domainCosmeticRules = state.cosmeticRules.filter(
    (rule) => rule.domains && rule.domains.length > 0
  );
  syncPageDnrAllowRule();

  if (!isPageAllowed(state.settings)) {
    return;
  }

  if (!isDomReplacementAllowed(state.settings)) {
    return;
  }

  // Observation goes first and nothing is allowed in front of it. A shadow root
  // that already exists by this line is watched, and an ad appearing in it later
  // is carded within a frame; a root missed here is only found by a warmup scan,
  // most of a second later. That is a race against the page's own scripts, so the
  // work between document_end and this line has to stay near zero.
  startObserver();

  ensureCardFont();
  // The fit pass is a measurement, and any card placed before the face arrives is
  // measured in the fallback: the default note is 256px wide at 16px in Helvetica
  // and 281px in Space Grotesk, which on a mobile banner is the difference
  // between one line and two. So refit once the face is really here.
  //
  // Asked for by name rather than waited on through document.fonts.ready, because
  // a face is only fetched when something uses it and nothing does yet — ready
  // resolves immediately, against the fallback, before the first card exists.
  document.fonts
    ?.load('500 1em "Space Grotesk"')
    .then(refitAllCards)
    .catch(() => {});

  const initialInserted = await runScan({ force: true });
  startWarmupScans({
    initialInserted,
    initialCandidates: state.lastScanCandidateCount
  });
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
        if (isDomReplacementAllowed(state.settings)) {
          startObserver();
          scheduleScan(80);
        } else {
          stopObserver();
        }
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
    if (isDomReplacementAllowed(state.settings)) {
      startObserver();
      scheduleScan(80);
    } else {
      stopObserver();
    }
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
      !isExtensionElement(target) &&
      shouldScanMutationTarget(target)
    ) {
      queuedScan = queueScanContext(target) || queuedScan;
    }
  }

  if (queuedScan) {
    scheduleScan(80);
  }
}

function queueScanContext(node) {
  if (node instanceof HTMLElement && !shouldScanMutationTarget(node)) {
    return false;
  }

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

function shouldScanMutationTarget(element) {
  if (!(element instanceof HTMLElement) || isExtensionElement(element)) {
    return false;
  }

  if (hasMutationAdSignal(element)) {
    return true;
  }

  if (hasDomainCosmeticMutationSignal(element)) {
    return true;
  }

  if (isMutationAdTag(element) || element.shadowRoot) {
    return true;
  }

  if (typeof element.querySelectorAll !== "function") {
    return false;
  }

  let checked = 0;
  try {
    const descendants = element.querySelectorAll(MUTATION_SCAN_TRIGGER_SELECTOR);
    for (const descendant of descendants) {
      if (!(descendant instanceof HTMLElement)) {
        continue;
      }
      checked += 1;
      if (isMutationAdTag(descendant) || hasMutationAdSignal(descendant)) {
        return true;
      }
      if (hasDomainCosmeticMutationSignal(descendant, { includeDescendants: false })) {
        return true;
      }
      if (checked >= MUTATION_DESCENDANT_SCAN_LIMIT) {
        return false;
      }
    }
  } catch (_error) {}

  return false;
}

function hasDomainCosmeticMutationSignal(
  element,
  { includeDescendants = true } = {}
) {
  if (!(element instanceof HTMLElement) || isExtensionElement(element)) {
    return false;
  }

  const rules = state.domainCosmeticRules || [];
  if (!rules.length) {
    return false;
  }

  for (const rule of rules) {
    try {
      if (element.matches(rule.selector)) {
        return true;
      }
      if (includeDescendants && element.querySelector(rule.selector)) {
        return true;
      }
    } catch (_error) {}
  }

  return false;
}

function isMutationAdTag(element) {
  const tagName = element.localName;
  return (
    tagName === "iframe" ||
    tagName === "ins" ||
    tagName === "amp-ad" ||
    tagName === "shreddit-ad-post" ||
    tagName === "ytd-ad-slot-renderer" ||
    tagName === "ytd-display-ad-renderer" ||
    tagName === "ytd-promoted-sparkles-web-renderer"
  );
}

function hasMutationAdSignal(element) {
  const value = [
    element.id,
    element.className,
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.getAttribute("src"),
    element.getAttribute("data-src"),
    element.getAttribute("data-ad-slot"),
    element.getAttribute("data-ad-client")
  ]
    .filter(Boolean)
    .join(" ");

  return MUTATION_AD_SIGNAL_RE.test(value);
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

// A content script's stylesheet cannot name an extension resource: a relative
// url() inside it resolves against the page, not the extension, so it 404s
// whether or not the file is web-accessible. Injecting the face from script is
// the only route that resolves, and the only one that survives a page CSP naming
// font-src — an inlined data: URL is blocked by such a policy, a
// chrome-extension: URL is not. The resource is declared with use_dynamic_url so
// the URL is a per-session token rather than this install's stable id.
//
// @font-face has to land in the document even for cards inside a shadow root,
// because a face declared inside a shadow tree is not applied.
function ensureCardFont() {
  const host = document.head || document.documentElement;
  if (!host || document.getElementById(CARD_FONT_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = CARD_FONT_STYLE_ID;
  // isExtensionElement recognises our nodes by class, so without this the page
  // observer takes our own injection for page content and schedules a scan at it.
  style.className = "attention-redirector-style";
  style.textContent = CARD_FONT_FILES.map(
    ({ file, range }) => `@font-face{
  font-family:"Space Grotesk";
  font-style:normal;
  font-weight:400 700;
  font-display:swap;
  src:url(${JSON.stringify(chrome.runtime.getURL(file))}) format("woff2");
  unicode-range:${range};
}`
  ).join("\n");
  host.append(style);
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

function startWarmupScans({ initialInserted = 0, initialCandidates = 0 } = {}) {
  const elementCount = document.getElementsByTagName("*").length;
  if (
    initialInserted === 0 &&
    initialCandidates === 0 &&
    elementCount >= LARGE_DOM_ZERO_SCAN_THRESHOLD
  ) {
    return;
  }

  [500, 1500, 3500, 7000].forEach((delay) => {
    window.setTimeout(() => {
      runScan({ force: false });
    }, delay);
  });
}

function scheduleScan(delay) {
  let safeDelay = Math.max(0, Number(delay) || 0);
  if (state.zeroScanStreak >= 8) {
    safeDelay = Math.max(safeDelay, 1500);
  } else if (state.zeroScanStreak >= 3) {
    safeDelay = Math.max(safeDelay, 500);
  }
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

    // The scan reads layout, so it prefers to run inside a frame. But a page
    // where nothing moves can go a long time without producing one — 650ms was
    // measured here — and until the ambient was removed the cards' own animation
    // was what kept the frames coming. Waiting on a frame that may never arrive
    // turns a late ad into most of a second of unreplaced page, so take
    // whichever arrives first.
    let scanned = false;
    const scan = () => {
      if (scanned) {
        return;
      }
      scanned = true;
      runScan({ force: false, contextNodes });
    };

    window.requestAnimationFrame(scan);
    window.setTimeout(scan, 100);
  }, safeDelay);
}
