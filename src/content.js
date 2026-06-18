(() => {
  const CONTENT_LOADED_KEY = "__attentionRedirectorContentLoaded";
  if (window[CONTENT_LOADED_KEY]) {
    return;
  }
  window[CONTENT_LOADED_KEY] = true;
  
  const STORAGE_KEY = "attentionRedirectorSettings";
  const INSPECTOR_REPORTS_KEY = "attentionRedirectorInspectorReports";
  
  const DEFAULT_SETTINGS = {
    enabled: true,
    mode: "quiet",
    anchorNote: "Finish what deserves your attention.",
    visualPresence: 10,
    reducedMotion: "system",
    disabledDomains: []
  };
  
  const SENSITIVE_DOMAINS = [
    "accounts.google.com",
    "docs.google.com",
    "drive.google.com",
    "mail.google.com",
    "inbox.google.com",
    "calendar.google.com",
    "notion.so",
    "figma.com",
    "paypal.com",
    "stripe.com",
    "venmo.com",
    "cash.app",
    "coinbase.com",
    "robinhood.com",
    "chase.com",
    "wellsfargo.com",
    "bankofamerica.com",
    "capitalone.com",
    "americanexpress.com",
    "amex.com",
    "citi.com",
    "citibank.com"
  ];
  
  const SENSITIVE_HOST_WORDS = [
    "bank",
    "brokerage",
    "checkout",
    "payments",
    "billing",
    "wallet"
  ];
  
  const SENSITIVE_PATH_RE =
    /\/(checkout|cart|basket|payment|payments|billing|invoice|invoices|pay|order|orders|purchase|subscribe|subscription|login|signin|sign-in|password|account\/security)(\/|$)/i;
  
  const HARD_UNSAFE_ANCESTOR_SELECTOR = [
    "nav",
    "form",
    "[role='navigation']",
    "[role='search']",
    "[role='form']",
    "[contenteditable='true']",
    ".attention-redirector-slot",
    ".attention-redirector-card",
    ".attention-redirector-inspector",
    ".attention-redirector-inspector-box"
  ].join(",");
  
  const SOFT_UNSAFE_ANCESTOR_SELECTOR = ["article", "header", "footer"].join(",");
  
  const SCAN_SELECTOR = [
    "div",
    "section",
    "aside",
    "ins",
    "iframe",
    "amp-ad",
    "shreddit-ad-post",
    "ytd-ad-slot-renderer",
    "ytd-display-ad-renderer",
    "ytd-promoted-sparkles-web-renderer",
    "[id]",
    "[class]",
    "[aria-label]",
    "[data-testid]",
    "[data-ad-slot]",
    "[data-ad-client]"
  ].join(",");
  
  const DEBUG_SCAN_SELECTOR = [
    "div",
    "section",
    "aside",
    "ins",
    "iframe",
    "img",
    "embed",
    "amp-ad",
    "[id]",
    "[class]",
    "[aria-label]",
    "[role]",
    "[style]",
    "[data-testid]",
    "[data-ad-slot]",
    "[data-ad-client]"
  ].join(",");
  
  const INSPECTOR_MAX_HIGHLIGHTS = 35;
  const INSPECTOR_MAX_REPORT_CANDIDATES = 20;
  const INSPECTOR_MAX_SAVED_REPORTS = 75;
  
  const AD_IDENTIFIER_RE =
    /(^|[\s_.:-])(ad|ads|adslot|ad-slot|ad_unit|ad-unit|advert|advertisement|advertising|sponsor|sponsored|promoted|promo|dfp|gpt|doubleclick|adsbygoogle|native-ad|paid-placement)([\s_.:-]|$)/i;
  
  const VIDEO_AD_IDENTIFIER_RE =
    /(^|[\s_.:-])(ima-ad-container|ad-container|ad_container|ima|vast|vpaid|preroll|pre-roll|midroll|mid-roll)([\s_.:-]|$)/i;
  
  const BANNER_IDENTIFIER_RE =
    /(^|[\s_.:-])(banner|leaderboard)([\s_.:-]|$)/i;
  
  const UNSAFE_IDENTIFIER_RE =
    /(comment|comments|reply|discussion|thread|editor|compose|message|chat|checkout|cart|basket|payment|billing|invoice|login|signin|password|cookie|consent|privacy|modal|dialog|toast|navigation|menu|navbar|breadcrumb|footer|header|search|subscribe|newsletter)/i;
  
  const HARD_UNSAFE_IDENTIFIER_RE =
    /(comment|comments|reply|discussion|thread|editor|compose|message|chat|checkout|cart|basket|payment|billing|invoice|login|signin|password|cookie|consent|privacy|navigation|menu|navbar|breadcrumb|search|subscribe|newsletter)/i;
  
  const SOFT_UNSAFE_IDENTIFIER_RE =
    /(modal|dialog|toast|footer|header)/i;
  
  const AD_TEXT_RE =
    /(^|\b)(advertisement|advertising|sponsored|promoted|paid placement)(\b|$)/i;
  
  const AD_SOURCE_RE =
    /(doubleclick|googlesyndication|googleadservices|adservice|adserver|adsystem|taboola|outbrain|criteo|rubiconproject|openx|pubmatic|adnxs|adsbygoogle|imasdk|ima3|vast|vpaid|schulist\.link)/i;
  
  const SCRIPT_IFRAME_SOURCE_RE =
    /(javascript:void|document\.write|document\.createElement\(['"]script|script\.innerHTML|script\.src)/i;
  
  const BRANDING_TAKEOVER_IDENTIFIER_RE =
    /(^|[\s_.:-])i?brnd[a-z0-9]{6,}([\s_.:-]|$)/i;
  
  const BRANDING_TAKEOVER_SOURCE_RE =
    /(?:^|[/:])iframehs(?:[/?#]|$)/i;
  
  const COMMON_AD_SIZES = [
    [300, 250],
    [336, 280],
    [728, 90],
    [970, 90],
    [970, 250],
    [320, 50],
    [320, 100],
    [160, 600],
    [300, 600],
    [250, 250],
    [468, 60]
  ];
  
  const state = {
    settings: mergeSettings(),
    settingsReady: false,
    inserted: 0,
    scanTimer: 0,
    scanDueAt: 0,
    observer: null,
    isScanning: false,
    cardSequence: 0,
    cosmeticRules: [],
    cosmeticMatches: new WeakMap(),
    replacementGuards: new WeakMap(),
    motionObserver: null,
    inspector: {
      active: false,
      overlay: null,
      boxes: [],
      candidates: [],
      selectedInfo: null,
      manualPick: false,
      manualCapture: null,
      hoverBox: null,
      hoverInfo: null,
      clickHandler: null,
      pointerMoveHandler: null,
      refreshHandler: null,
      refreshTimer: 0
    }
  };
  
  
  
  
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
  
  function toggleInspector() {
    if (state.inspector.active) {
      stopInspector();
      return { inspectorActive: false, inspectorCandidateCount: 0 };
    }
  
    if (isSensitivePage()) {
      return {
        inspectorActive: false,
        inspectorCandidateCount: 0,
        inspectorError: "Inspector is skipped on sensitive pages."
      };
    }
  
    startInspector();
    return {
      inspectorActive: true,
      inspectorCandidateCount: state.inspector.candidates.length
    };
  }
  
  function startInspector() {
    if (state.inspector.active || !document.documentElement) {
      return;
    }
  
    state.inspector.active = true;
    state.inspector.overlay = buildInspectorOverlay();
    document.documentElement.appendChild(state.inspector.overlay);
  
    state.inspector.clickHandler = handleInspectorClick;
    state.inspector.pointerMoveHandler = handleInspectorPointerMove;
    state.inspector.refreshHandler = scheduleInspectorRefresh;
  
    document.addEventListener("click", state.inspector.clickHandler, true);
    document.addEventListener("pointermove", state.inspector.pointerMoveHandler, true);
    window.addEventListener("scroll", state.inspector.refreshHandler, true);
    window.addEventListener("resize", state.inspector.refreshHandler);
  
    refreshInspector();
  }
  
  function stopInspector() {
    if (!state.inspector.active) {
      return;
    }
  
    document.removeEventListener("click", state.inspector.clickHandler, true);
    document.removeEventListener("pointermove", state.inspector.pointerMoveHandler, true);
    window.removeEventListener("scroll", state.inspector.refreshHandler, true);
    window.removeEventListener("resize", state.inspector.refreshHandler);
    window.clearTimeout(state.inspector.refreshTimer);
    clearInspectorBoxes();
    clearManualHoverBox();
  
    if (state.inspector.overlay) {
      state.inspector.overlay.remove();
    }
  
    state.inspector.active = false;
    state.inspector.overlay = null;
    state.inspector.candidates = [];
    state.inspector.selectedInfo = null;
    state.inspector.manualPick = false;
    clearManualCaptureLayer();
    state.inspector.hoverBox = null;
    state.inspector.hoverInfo = null;
    state.inspector.clickHandler = null;
    state.inspector.pointerMoveHandler = null;
    state.inspector.refreshHandler = null;
  }
  
  function buildInspectorOverlay() {
    const overlay = document.createElement("div");
    overlay.className = "attention-redirector-inspector";
  
    const header = document.createElement("div");
    header.className = "attention-redirector-inspector__header";
  
    const titleBlock = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = "Clutter inspector";
    const subtitle = document.createElement("span");
    subtitle.textContent = "Click a missed banner, popup, or animated slot.";
    titleBlock.append(title, subtitle);
  
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "Close";
    closeButton.addEventListener("click", stopInspector);
  
    header.append(titleBlock, closeButton);
  
    const summary = document.createElement("p");
    summary.className = "attention-redirector-inspector__summary";
    summary.dataset.attentionRedirectorInspectorSummary = "true";
  
    const details = document.createElement("pre");
    details.className = "attention-redirector-inspector__details";
    details.dataset.attentionRedirectorInspectorDetails = "true";
  
    const actions = document.createElement("div");
    actions.className = "attention-redirector-inspector__actions";
  
    const refreshButton = document.createElement("button");
    refreshButton.type = "button";
    refreshButton.textContent = "Refresh highlights";
    refreshButton.addEventListener("click", refreshInspector);
  
    const manualPickButton = document.createElement("button");
    manualPickButton.type = "button";
    manualPickButton.textContent = "Manual pick";
    manualPickButton.dataset.attentionRedirectorManualPick = "true";
    manualPickButton.addEventListener("click", toggleManualPick);
  
    const parentButton = document.createElement("button");
    parentButton.type = "button";
    parentButton.textContent = "Use parent";
    parentButton.addEventListener("click", selectInspectorParent);
  
    const saveCopyButton = document.createElement("button");
    saveCopyButton.type = "button";
    saveCopyButton.textContent = "Save + copy";
    saveCopyButton.addEventListener("click", saveAndCopyInspectorReport);
  
    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.textContent = "Export saved";
    exportButton.addEventListener("click", copySavedInspectorReports);
  
    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.textContent = "Clear saved";
    clearButton.addEventListener("click", clearSavedInspectorReports);
  
    const copyStatus = document.createElement("span");
    copyStatus.dataset.attentionRedirectorInspectorCopyStatus = "true";
  
    const savedCount = document.createElement("span");
    savedCount.className = "attention-redirector-inspector__saved-count";
    savedCount.dataset.attentionRedirectorSavedCount = "true";
    savedCount.textContent = "Saved: checking";
  
    actions.append(
      refreshButton,
      manualPickButton,
      parentButton,
      saveCopyButton,
      exportButton,
      clearButton,
      copyStatus,
      savedCount
    );
    overlay.append(header, summary, details, actions);
    return overlay;
  }
  
  function scheduleInspectorRefresh() {
    if (!state.inspector.active) {
      return;
    }
  
    window.clearTimeout(state.inspector.refreshTimer);
    state.inspector.refreshTimer = window.setTimeout(refreshInspector, 120);
  }
  
  function refreshInspector() {
    if (!state.inspector.active) {
      return;
    }
  
    clearInspectorBoxes();
    state.inspector.candidates = collectInspectorCandidates();
    renderInspectorBoxes();
  
    if (state.inspector.selectedInfo) {
      state.inspector.selectedInfo = inspectElement(
        state.inspector.selectedInfo.element,
        ["manual click"]
      );
      renderSelectedBox(state.inspector.selectedInfo);
    }
  
    updateInspectorOverlay();
    updateSavedReportCount();
  }
  
  function clearInspectorBoxes() {
    state.inspector.boxes.forEach((box) => box.remove());
    state.inspector.boxes = [];
  }
  
  function collectInspectorCandidates() {
    const records = [];
    const seen = new Set();
    const nodes = Array.from(document.querySelectorAll(DEBUG_SCAN_SELECTOR));
  
    for (const node of nodes) {
      const element = getCandidateElement(node);
      if (!element || seen.has(element) || isExtensionElement(element)) {
        continue;
      }
  
      const info = inspectElement(element);
      if (info.score < 3) {
        continue;
      }
  
      records.push(info);
      seen.add(element);
    }
  
    return dedupeInspectorRecords(records).slice(0, INSPECTOR_MAX_HIGHLIGHTS);
  }
  
  function dedupeInspectorRecords(records) {
    const selected = [];
    const sorted = records.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.rect.area - b.rect.area;
    });
  
    for (const record of sorted) {
      const overlapsExisting = selected.some((item) => {
        return (
          item.element.contains(record.element) ||
          record.element.contains(item.element)
        );
      });
  
      if (!overlapsExisting) {
        selected.push(record);
      }
    }
  
    return selected.sort((a, b) => {
      if (Math.abs(a.rect.top - b.rect.top) > 20) {
        return a.rect.top - b.rect.top;
      }
      return a.rect.left - b.rect.left;
    });
  }
  
  function renderInspectorBoxes() {
    state.inspector.candidates.forEach((info, index) => {
      const box = buildInspectorBox(info, `#${index + 1}`);
      const label = box.querySelector(".attention-redirector-inspector-box__label");
      if (label) {
        label.dataset.attentionRedirectorIndex = String(index);
      }
      document.documentElement.appendChild(box);
      state.inspector.boxes.push(box);
    });
  }
  
  function renderSelectedBox(info) {
    const box = buildInspectorBox(info, "selected");
    box.classList.add("attention-redirector-inspector-box--selected");
    const label = box.querySelector(".attention-redirector-inspector-box__label");
    if (label) {
      label.dataset.attentionRedirectorSelected = "true";
    }
    document.documentElement.appendChild(box);
    state.inspector.boxes.push(box);
  }
  
  function buildInspectorBox(info, labelText) {
    const box = document.createElement("div");
    box.className = "attention-redirector-inspector-box";
    box.style.top = `${Math.max(0, Math.round(info.rect.top))}px`;
    box.style.left = `${Math.max(0, Math.round(info.rect.left))}px`;
    box.style.width = `${Math.max(1, Math.round(info.rect.width))}px`;
    box.style.height = `${Math.max(1, Math.round(info.rect.height))}px`;
  
    const label = document.createElement("span");
    label.className = "attention-redirector-inspector-box__label";
    label.textContent = `${labelText} ${info.reasons.slice(0, 2).join(", ")}`;
    box.append(label);
    return box;
  }
  
  function handleInspectorClick(event) {
    if (!state.inspector.active) {
      return;
    }
  
    const inspectorBox =
      event.target instanceof Element
        ? event.target.closest(".attention-redirector-inspector-box")
        : null;
    if (inspectorBox) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      const label =
        event.target instanceof Element
          ? event.target.closest(".attention-redirector-inspector-box__label")
          : null;
      if (label) {
        const index = Number.parseInt(label.dataset.attentionRedirectorIndex, 10);
        if (Number.isFinite(index) && state.inspector.candidates[index]) {
          selectInspectorCandidate(state.inspector.candidates[index]);
        } else if (
          label.dataset.attentionRedirectorSelected === "true" &&
          state.inspector.selectedInfo
        ) {
          selectInspectorCandidate(state.inspector.selectedInfo);
        }
      }
      return;
    }
  
    if (
      event.target instanceof Element &&
      event.target.closest(".attention-redirector-inspector")
    ) {
      return;
    }
  
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
  
    const element = state.inspector.manualPick
      ? getInspectableElementAtPoint(event.clientX, event.clientY)
      : getInspectableElement(event.target);
    if (!element) {
      return;
    }
  
    selectInspectorCandidate(
      inspectElement(element, [
        state.inspector.manualPick ? "manual pick" : "manual click"
      ])
    );
    if (state.inspector.manualPick) {
      state.inspector.manualPick = false;
      clearManualCaptureLayer();
      clearManualHoverBox();
      updateInspectorOverlay();
    }
  }
  
  function selectInspectorCandidate(info) {
    const manualReasons = info.reasons.filter((reason) => {
      return reason.startsWith("manual ");
    });
    state.inspector.selectedInfo = inspectElement(
      info.element,
      manualReasons.length ? manualReasons : ["manual click"]
    );
    refreshInspector();
  }
  
  function getInspectableElement(target) {
    return pickBestInspectableElement([target]);
  }
  
  function getInspectableElementAtPoint(x, y) {
    const capture = state.inspector.manualCapture;
    const previousPointerEvents = capture ? capture.style.pointerEvents : "";
  
    if (capture) {
      capture.style.pointerEvents = "none";
    }
  
    const elements = document.elementsFromPoint(x, y);
  
    if (capture) {
      capture.style.pointerEvents = previousPointerEvents;
    }
  
    return pickBestInspectableElement(elements);
  }
  
  function pickBestInspectableElement(targets) {
    const records = [];
    const seen = new Set();
  
    targets.forEach((target, stackIndex) => {
      if (!(target instanceof HTMLElement) || isExtensionElement(target)) {
        return;
      }
  
      let current = target;
      let depth = 0;
  
      while (current && current !== document.body && depth < 9) {
        if (current instanceof HTMLElement && !isExtensionElement(current)) {
          addInspectableRecord(records, seen, current, stackIndex, depth);
          const wrapper = promoteToAdWrapper(current);
          if (wrapper && wrapper !== current) {
            addInspectableRecord(records, seen, wrapper, stackIndex, depth - 0.5);
          }
        }
  
        current = current.parentElement;
        depth += 1;
      }
    });
  
    records.sort((a, b) => b.score - a.score);
    return records.length ? records[0].element : null;
  }
  
  function addInspectableRecord(records, seen, element, stackIndex, depth) {
    if (seen.has(element)) {
      return;
    }
  
    const rect = element.getBoundingClientRect();
    if (!isVisibleRect(rect) || isTooLargeForInspector(rect, element)) {
      return;
    }
  
    seen.add(element);
    records.push({
      element,
      score: getInspectableElementScore(element, stackIndex, depth)
    });
  }
  
  function getInspectableElementScore(element, stackIndex, depth) {
    const info = inspectElement(element);
    const rect = element.getBoundingClientRect();
    let score = info.score;
    const strongAdSignal = hasStrongAdSignal(element);
  
    if (isAdWrapperCandidate(element)) {
      score += 8;
    }
  
    if (strongAdSignal) {
      score += 5;
    }
  
    if (getMatchReason(element)) {
      score += 4;
    }
  
    if (rect.width >= 120 && rect.height >= 60) {
      score += 1;
    }
  
    const isBroadGenericAncestor =
      element.matches("main,article,aside,section") &&
      rect.width * rect.height > 180000 &&
      !isAdWrapperCandidate(element);
  
    if (isBroadGenericAncestor) {
      score -= 14;
    } else if (!strongAdSignal && rect.width * rect.height > 180000) {
      score -= 8;
    }
  
    return score - stackIndex * 0.35 - depth * 1.15;
  }
  
  function updateInspectorOverlay() {
    const summary = state.inspector.overlay.querySelector(
      "[data-attention-redirector-inspector-summary]"
    );
    const details = state.inspector.overlay.querySelector(
      "[data-attention-redirector-inspector-details]"
    );
    const manualPickButton = state.inspector.overlay.querySelector(
      "[data-attention-redirector-manual-pick]"
    );
  
    summary.textContent = state.inspector.manualPick
      ? "Manual pick is on. Hover a missed area, then click to select it."
      : `${state.inspector.candidates.length} suspects highlighted. Normal replacement is still conservative.`;
    details.textContent = state.inspector.selectedInfo
      ? formatElementReport(state.inspector.selectedInfo, "Selected element")
      : "Click a dark inspector label, or use Manual pick for anything not highlighted.";
  
    if (manualPickButton) {
      manualPickButton.textContent = state.inspector.manualPick
        ? "Stop manual"
        : "Manual pick";
      manualPickButton.classList.toggle(
        "attention-redirector-inspector__button--active",
        state.inspector.manualPick
      );
    }
  }
  
  function toggleManualPick() {
    state.inspector.manualPick = !state.inspector.manualPick;
  
    if (state.inspector.manualPick) {
      ensureManualCaptureLayer();
    } else {
      clearManualCaptureLayer();
      clearManualHoverBox();
    }
  
    updateInspectorOverlay();
  }
  
  function handleInspectorPointerMove(event) {
    if (!state.inspector.active || !state.inspector.manualPick) {
      return;
    }
  
    if (
      event.target instanceof Element &&
      event.target.closest(".attention-redirector-inspector")
    ) {
      return;
    }
  
    const element = getInspectableElementAtPoint(event.clientX, event.clientY);
    if (!element) {
      clearManualHoverBox();
      return;
    }
  
    state.inspector.hoverInfo = inspectElement(element, ["manual hover"]);
    renderManualHoverBox(state.inspector.hoverInfo);
  }
  
  function renderManualHoverBox(info) {
    if (!state.inspector.hoverBox) {
      state.inspector.hoverBox = document.createElement("div");
      state.inspector.hoverBox.className = "attention-redirector-manual-hover";
      const label = document.createElement("span");
      state.inspector.hoverBox.append(label);
      document.documentElement.appendChild(state.inspector.hoverBox);
    }
  
    state.inspector.hoverBox.style.top = `${Math.max(
      0,
      Math.round(info.rect.top)
    )}px`;
    state.inspector.hoverBox.style.left = `${Math.max(
      0,
      Math.round(info.rect.left)
    )}px`;
    state.inspector.hoverBox.style.width = `${Math.max(
      1,
      Math.round(info.rect.width)
    )}px`;
    state.inspector.hoverBox.style.height = `${Math.max(
      1,
      Math.round(info.rect.height)
    )}px`;
    state.inspector.hoverBox.querySelector("span").textContent =
      `manual ${info.signature}`;
  }
  
  function ensureManualCaptureLayer() {
    if (state.inspector.manualCapture) {
      return;
    }
  
    const capture = document.createElement("div");
    capture.className = "attention-redirector-manual-capture";
    if (state.inspector.overlay && state.inspector.overlay.parentElement) {
      state.inspector.overlay.parentElement.insertBefore(
        capture,
        state.inspector.overlay
      );
    } else {
      document.documentElement.appendChild(capture);
    }
    state.inspector.manualCapture = capture;
  }
  
  function clearManualCaptureLayer() {
    if (state.inspector.manualCapture) {
      state.inspector.manualCapture.remove();
    }
  
    state.inspector.manualCapture = null;
  }
  
  function clearManualHoverBox() {
    if (state.inspector.hoverBox) {
      state.inspector.hoverBox.remove();
    }
  
    state.inspector.hoverBox = null;
    state.inspector.hoverInfo = null;
  }
  
  function selectInspectorParent() {
    if (!state.inspector.selectedInfo) {
      setInspectorStatus("Select something first.");
      return;
    }
  
    const parent = findInspectableParent(state.inspector.selectedInfo.element);
    if (!parent) {
      setInspectorStatus("No useful parent found.");
      return;
    }
  
    selectInspectorCandidate(inspectElement(parent, ["manual parent"]));
  }
  
  function findInspectableParent(element) {
    let current = element.parentElement;
  
    while (current && current !== document.body) {
      if (
        current instanceof HTMLElement &&
        !isExtensionElement(current) &&
        isVisibleRect(current.getBoundingClientRect()) &&
        !isTooLargeForInspector(current.getBoundingClientRect(), current)
      ) {
        return current;
      }
  
      current = current.parentElement;
    }
  
    return null;
  }
  
  function setInspectorStatus(message) {
    const status = state.inspector.overlay.querySelector(
      "[data-attention-redirector-inspector-copy-status]"
    );
  
    if (!status) {
      return;
    }
  
    status.textContent = message;
    window.setTimeout(() => {
      status.textContent = "";
    }, 1600);
  }
  
  async function saveAndCopyInspectorReport() {
    const status = state.inspector.overlay.querySelector(
      "[data-attention-redirector-inspector-copy-status]"
    );
  
    if (!state.inspector.selectedInfo) {
      status.textContent = "Click a missed item first.";
      return;
    }
  
    const record = createInspectorReportRecord(state.inspector.selectedInfo);
  
    try {
      const savedCount = await saveInspectorReport(record);
      await copyText(record.text);
      status.textContent = `Saved + copied (${savedCount}).`;
      updateSavedReportCount(savedCount);
    } catch (_error) {
      status.textContent = "Save/copy failed.";
    }
  
    window.setTimeout(() => {
      status.textContent = "";
    }, 1600);
  }
  
  async function copySavedInspectorReports() {
    const status = state.inspector.overlay.querySelector(
      "[data-attention-redirector-inspector-copy-status]"
    );
    const reports = await loadInspectorReports();
  
    if (!reports.length) {
      status.textContent = "No saved reports.";
      return;
    }
  
    try {
      await copyText(formatSavedInspectorReports(reports));
      status.textContent = `Copied ${reports.length} saved.`;
    } catch (_error) {
      status.textContent = "Export failed.";
    }
  
    window.setTimeout(() => {
      status.textContent = "";
    }, 1600);
  }
  
  async function clearSavedInspectorReports() {
    const status = state.inspector.overlay.querySelector(
      "[data-attention-redirector-inspector-copy-status]"
    );
    await saveInspectorReports([]);
    status.textContent = "Cleared saved.";
    updateSavedReportCount(0);
  
    window.setTimeout(() => {
      status.textContent = "";
    }, 1600);
  }
  
  function createInspectorReportRecord(info) {
    const createdAt = new Date().toISOString();
    const inferredType = inferClutterType(info);
    const record = {
      id: `${Date.now()}-${hashString(`${location.href}:${info.signature}`)}`,
      createdAt,
      url: location.href,
      hostname: location.hostname,
      title: document.title,
      inferredType,
      signature: info.signature,
      text: formatSelectedInspectorReport(info, {
        createdAt,
        inferredType
      })
    };
  
    return record;
  }
  
  function inferClutterType(info) {
    const reasonText = info.reasons.join(" ").toLowerCase();
    const signature = info.signature.toLowerCase();
    const rect = info.rect;
  
    if (reasonText.includes("popup") || info.css.position === "fixed") {
      return "sticky popup / fixed overlay";
    }
  
    if (reasonText.includes("animated")) {
      return "animated rectangle";
    }
  
    if (reasonText.includes("sidebar") || rect.width <= 360) {
      return "sidebar rectangle";
    }
  
    if (signature.includes("sponsor") || reasonText.includes("sponsor")) {
      return "sponsored/native block";
    }
  
    if (rect.width >= 600 && rect.height <= 140) {
      return "top/banner slot";
    }
  
    return "missed clutter";
  }
  
  function formatSelectedInspectorReport(info, context) {
    return [
      "Attention Redirector Missed Clutter Report",
      `Generated: ${context.createdAt}`,
      `Page: ${location.href}`,
      `Host: ${location.hostname}`,
      `Title: ${document.title}`,
      `Inferred type: ${context.inferredType}`,
      "",
      formatElementReport(info, "Clicked element")
    ].join("\n");
  }
  
  function formatSavedInspectorReports(reports) {
    const lines = [
      "Attention Redirector Saved Inspector Reports",
      `Exported: ${new Date().toISOString()}`,
      `Count: ${reports.length}`
    ];
  
    reports.forEach((record, index) => {
      lines.push(
        "",
        `--- Report ${index + 1} / ${reports.length} ---`,
        record.text
      );
    });
  
    return lines.join("\n");
  }
  
  async function saveInspectorReport(record) {
    const reports = await loadInspectorReports();
    const withoutDuplicate = reports.filter((item) => {
      return !(
        item.url === record.url &&
        item.signature === record.signature &&
        item.inferredType === record.inferredType
      );
    });
    const nextReports = [record, ...withoutDuplicate].slice(
      0,
      INSPECTOR_MAX_SAVED_REPORTS
    );
  
    await saveInspectorReports(nextReports);
    return nextReports.length;
  }
  
  function loadInspectorReports() {
    return new Promise((resolve) => {
      chrome.storage.local.get(INSPECTOR_REPORTS_KEY, (items) => {
        const reports = Array.isArray(items[INSPECTOR_REPORTS_KEY])
          ? items[INSPECTOR_REPORTS_KEY]
          : [];
        resolve(reports);
      });
    });
  }
  
  function saveInspectorReports(reports) {
    return new Promise((resolve) => {
      chrome.storage.local.set(
        {
          [INSPECTOR_REPORTS_KEY]: reports
        },
        resolve
      );
    });
  }
  
  async function updateSavedReportCount(knownCount) {
    if (!state.inspector.active || !state.inspector.overlay) {
      return;
    }
  
    const countNode = state.inspector.overlay.querySelector(
      "[data-attention-redirector-saved-count]"
    );
  
    if (!countNode) {
      return;
    }
  
    const count =
      typeof knownCount === "number"
        ? knownCount
        : (await loadInspectorReports()).length;
  
    countNode.textContent = `Saved: ${count}`;
  }
  
  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  
  function formatInspectorReport() {
    const lines = [
      "Attention Redirector Inspector Report",
      `Generated: ${new Date().toISOString()}`,
      `Page: ${location.href}`,
      `Title: ${document.title}`,
      "",
      state.inspector.selectedInfo
        ? formatElementReport(state.inspector.selectedInfo, "Selected element")
        : "Selected element: none",
      "",
      `Top highlighted suspects: ${Math.min(
        state.inspector.candidates.length,
        INSPECTOR_MAX_REPORT_CANDIDATES
      )}`
    ];
  
    state.inspector.candidates
      .slice(0, INSPECTOR_MAX_REPORT_CANDIDATES)
      .forEach((info, index) => {
        lines.push("", formatElementReport(info, `Suspect #${index + 1}`));
      });
  
    return lines.join("\n");
  }
  
  function formatElementReport(info, heading) {
    return [
      `${heading}: ${info.signature}`,
      `Reasons: ${info.reasons.join(", ") || "none"}`,
      `Would replace now: ${info.wouldReplace ? "yes" : "no"}`,
      `Safety blocks: ${info.safetyBlocks.join(", ") || "none"}`,
      `Score: ${info.score}`,
      `Rect: ${Math.round(info.rect.width)}x${Math.round(info.rect.height)} at ${Math.round(
        info.rect.left
      )},${Math.round(info.rect.top)} area=${Math.round(info.rect.area)}`,
      `CSS: position=${info.css.position} z-index=${info.css.zIndex} display=${info.css.display} opacity=${info.css.opacity}`,
      `Role/label: ${info.role || "none"} / ${info.ariaLabel || "none"}`,
      `Text: ${info.textSnippet || "none"}`,
      `Sources: ${info.sources.join(" | ") || "none"}`,
      `Ancestry: ${info.ancestry.join(" > ")}`
    ].join("\n");
  }
  
  
  async function runScan({ force }) {
    if (!state.settingsReady) {
      return 0;
    }
  
    if (!state.settings) {
      state.settings = await loadSettings();
    }
  
    if (!isPageAllowed(state.settings) || state.isScanning) {
      return 0;
    }
  
    state.isScanning = true;
    let inserted = 0;
  
    try {
      const candidates = collectCandidates();
  
      for (const candidate of candidates) {
        if (!force && inserted >= 6) {
          break;
        }
  
        if (replaceCandidate(candidate)) {
          inserted += 1;
          state.inserted += 1;
        }
      }
    } finally {
      state.isScanning = false;
    }
  
    return inserted;
  }
  
  function collectCandidates() {
    state.cosmeticMatches = new WeakMap();
    const nodes = [
      ...Array.from(document.querySelectorAll(SCAN_SELECTOR)),
      ...collectCosmeticCandidateNodes()
    ];
    const candidates = [];
    const seen = new Set();
  
    for (const node of nodes) {
      const cosmeticMatch = state.cosmeticMatches.get(node);
      const candidate = getCandidateElement(node);
      if (!candidate || seen.has(candidate)) {
        continue;
      }
  
      if (cosmeticMatch) {
        state.cosmeticMatches.set(candidate, cosmeticMatch);
      }
  
      const reason = getMatchReason(candidate);
      if (!reason) {
        continue;
      }
  
      candidate.dataset.attentionRedirectorReason = reason;
      candidates.push(candidate);
      seen.add(candidate);
    }
  
    return candidates
      .filter((candidate) => !hasCandidateDescendant(candidate, candidates))
      .sort((a, b) => getArea(a) - getArea(b));
  }
  
  function collectCosmeticCandidateNodes() {
    const nodes = [];
    const seen = new Set();
    const maxMatches = 260;
  
    if (!state.cosmeticRuleChunks) {
      state.cosmeticRuleChunks = [];
      let currentChunk = [];
      for (const rule of state.cosmeticRules) {
        currentChunk.push(rule);
        if (currentChunk.length >= 60) {
          state.cosmeticRuleChunks.push(currentChunk);
          currentChunk = [];
        }
      }
      if (currentChunk.length > 0) {
        state.cosmeticRuleChunks.push(currentChunk);
      }
      for (const chunk of state.cosmeticRuleChunks) {
        try {
          chunk.selectorString = chunk.map(r => r.selector).join(', ');
          document.querySelector(chunk.selectorString); // test if valid
        } catch (e) {
          chunk.selectorString = null; // force individual fallback if invalid selector in chunk
        }
      }
    }
  
    for (const chunk of state.cosmeticRuleChunks) {
      let matches = [];
  
      if (chunk.selectorString) {
        try {
          matches = Array.from(document.querySelectorAll(chunk.selectorString));
        } catch (_error) {}
      } else {
        for (const rule of chunk) {
          try {
            const ruleMatches = Array.from(document.querySelectorAll(rule.selector));
            for (const el of ruleMatches) {
              if (!matches.includes(el)) matches.push(el);
            }
          } catch (e) {}
        }
      }
  
      for (const element of matches.slice(0, 60)) {
        if (!(element instanceof HTMLElement) || seen.has(element)) {
          continue;
        }
  
        const matchingRule = chunk.find(r => {
          try { return element.matches(r.selector); } catch(e) { return false; }
        });
  
        if (matchingRule) {
          state.cosmeticMatches.set(element, matchingRule);
          nodes.push(element);
          seen.add(element);
  
          if (nodes.length >= maxMatches) {
            return nodes;
          }
        }
      }
    }
  
    return nodes;
  }
  
  function getCandidateElement(node) {
    if (!(node instanceof HTMLElement)) {
      return null;
    }
  
    const brandingTakeover = findBrandingTakeoverContainer(node);
    if (brandingTakeover) {
      return brandingTakeover;
    }
  
    let candidate = node;
  
    if (node.matches("iframe,img,embed,amp-ad")) {
      const parent = node.parentElement;
      if (parent && safeToReplace(parent) && hasSimilarRect(node, parent)) {
        candidate = parent;
      }
    }
  
    return promoteToAdWrapper(candidate);
  }
  
  function hasCandidateDescendant(candidate, candidates) {
    return candidates.some((other) => {
      return (
        other !== candidate &&
        candidate.contains(other) &&
        !isAdWrapperCandidate(candidate, other)
      );
    });
  }
  
  function promoteToAdWrapper(element) {
    if (VIDEO_AD_IDENTIFIER_RE.test(getIdentifierText(element))) {
      return element;
    }
  
    let current = element;
    let best = element;
    let depth = 0;
  
    while (current && current !== document.body && depth < 7) {
      if (
        current instanceof HTMLElement &&
        !isExtensionElement(current) &&
        isAdWrapperCandidate(current, element)
      ) {
        best = current;
      }
  
      current = current.parentElement;
      depth += 1;
    }
  
    return best;
  }
  
  function isAdWrapperCandidate(element, origin = element) {
    if (!(element instanceof HTMLElement) || isExtensionElement(element)) {
      return false;
    }
  
    if (element.matches("html,body,main,article,nav,header,footer,form")) {
      return false;
    }
  
    if (hasHardUnsafeAncestor(element) || hasHardUnsafeIdentifier(element)) {
      return false;
    }
  
    const rect = element.getBoundingClientRect();
    const brandingTakeover = isBrandingTakeover(element);
    if (
      !isVisibleRect(rect) ||
      (isTooLargeForExplicitAd(rect) && !brandingTakeover)
    ) {
      return false;
    }
  
    if (origin && origin !== element) {
      const originRect = origin.getBoundingClientRect();
      if (!rectContainsMost(rect, originRect)) {
        return false;
      }
    }
  
    if (element.querySelector("form,input,textarea,select,[contenteditable='true']")) {
      return false;
    }
  
    const identifiers = getIdentifierText(element);
    const textLabel = getShortLabelText(element);
    const sources = getSourceValues(element).join(" ");
  
    return Boolean(
      brandingTakeover ||
        AD_IDENTIFIER_RE.test(identifiers) ||
        VIDEO_AD_IDENTIFIER_RE.test(identifiers) ||
        AD_TEXT_RE.test(textLabel) ||
        AD_SOURCE_RE.test(sources)
    );
  }
  
  function rectContainsMost(containerRect, childRect) {
    const overlapLeft = Math.max(containerRect.left, childRect.left);
    const overlapTop = Math.max(containerRect.top, childRect.top);
    const overlapRight = Math.min(containerRect.right, childRect.right);
    const overlapBottom = Math.min(containerRect.bottom, childRect.bottom);
    const overlapWidth = Math.max(0, overlapRight - overlapLeft);
    const overlapHeight = Math.max(0, overlapBottom - overlapTop);
    const childArea = childRect.width * childRect.height;
  
    if (childArea <= 0) {
      return false;
    }
  
    return (overlapWidth * overlapHeight) / childArea >= 0.85;
  }
  
  function getMatchReason(element) {
    if (!safeToReplace(element)) {
      return "";
    }
  
    if (isBrandingTakeover(element)) {
      return "full-page branding takeover";
    }
  
    const cosmeticMatch = getCosmeticMatch(element);
    if (cosmeticMatch) {
      return `cosmetic filter: ${cosmeticMatch.selector}`;
    }
  
    const identifiers = getIdentifierText(element);
    const textLabel = getShortLabelText(element);
    const rect = element.getBoundingClientRect();
    const hasAdIdentifier = AD_IDENTIFIER_RE.test(identifiers);
    const hasBannerIdentifier = BANNER_IDENTIFIER_RE.test(identifiers);
    const hasAdText = AD_TEXT_RE.test(textLabel);
    const hasAdSource = hasAdLikeSource(element);
    const hasScriptIframe = hasScriptAdIframe(element);
    const hasCommonSize = isCommonAdSize(rect);
  
    if (hasAdIdentifier) {
      return "ad-like identifier";
    }
  
    if (hasAdText && (isSmallContainer(rect) || isSidebarElement(element))) {
      return "sponsored label";
    }
  
    if (hasBannerIdentifier && hasCommonSize && !isLikelyHeroBanner(element)) {
      return "banner-sized slot";
    }
  
    if (hasCommonSize && (hasAdSource || hasAdText || isSidebarElement(element))) {
      return "common ad-sized slot";
    }
  
    if (hasAdSource && (hasAdText || isFixedOrSticky(element) || isSmallContainer(rect))) {
      return "ad-like source";
    }
  
    if (hasScriptIframe && isSmallContainer(rect)) {
      return "script iframe slot";
    }
  
    return "";
  }
  
  function safeToReplace(element) {
    if (!element || element.dataset.attentionRedirectorReplaced === "true") {
      return false;
    }
  
    if (element === document.body || element === document.documentElement) {
      return false;
    }
  
    if (element.matches("main,article,header,footer")) {
      return false;
    }
  
    if (containsExplicitVideoAdLayer(element) && !hasOwnAdIdentifier(element)) {
      return false;
    }
  
    if (hasHardUnsafeAncestor(element)) {
      return false;
    }
  
    const strongAdSignal = hasStrongAdSignal(element);
    const explicitAdSlot = isExplicitAdSlot(element);
  
    if (
      (hasHardUnsafeIdentifier(element) ||
        hasHardUnsafeIdentifierInAncestors(element)) &&
      !explicitAdSlot
    ) {
      return false;
    }
  
    if (
      (hasSoftUnsafeAncestor(element) ||
        hasSoftUnsafeIdentifier(element) ||
        hasSoftUnsafeIdentifierInAncestors(element)) &&
      !strongAdSignal
    ) {
      return false;
    }
  
    if (element.querySelector("form,input,textarea,select,[contenteditable='true']")) {
      return false;
    }
  
    if (element.closest("a[href]") && !hasAdLikeSource(element)) {
      return false;
    }
  
    const rect = element.getBoundingClientRect();
    if (!isVisibleRect(rect)) {
      return false;
    }
  
    if (
      isTooLargeForMvp(rect) &&
      !isBrandingTakeover(element) &&
      !canReplaceExplicitLargeAd(element, rect)
    ) {
      return false;
    }
  
    return true;
  }
  
  function hasStrongAdSignal(element) {
    const identifiers = getIdentifierText(element);
    const textLabel = getShortLabelText(element);
    const rect = element.getBoundingClientRect();
  
    return Boolean(
      isBrandingTakeover(element) ||
        hasCosmeticMatch(element) ||
        AD_IDENTIFIER_RE.test(identifiers) ||
        VIDEO_AD_IDENTIFIER_RE.test(identifiers) ||
        AD_TEXT_RE.test(textLabel) ||
        hasAdLikeSource(element) ||
        hasScriptAdIframe(element) ||
        (isCommonAdSize(rect) &&
          (AD_SOURCE_RE.test(getSourceValues(element).join(" ")) ||
            AD_IDENTIFIER_RE.test(identifiers)))
    );
  }
  
  function isExplicitAdSlot(element) {
    const identifiers = getIdentifierText(element);
    const textLabel = getShortLabelText(element);
    const sourceText = getSourceValues(element).join(" ");
    const rect = element.getBoundingClientRect();
  
    if (isBrandingTakeover(element)) {
      return true;
    }
  
    if (AD_SOURCE_RE.test(sourceText)) {
      return true;
    }
  
    if (hasScriptAdIframe(element)) {
      return true;
    }
  
    if (AD_TEXT_RE.test(textLabel) && element.matches("iframe,ins,amp-ad")) {
      return true;
    }
  
    if (
      /(google_ads_iframe|div-gpt-ad|adsbygoogle|adthrive|safeframe|doubleclick|googlesyndication|ima-ad-container)/i.test(
        `${identifiers} ${sourceText}`
      )
    ) {
      return true;
    }
  
    return Boolean(
      AD_IDENTIFIER_RE.test(identifiers) &&
        (AD_TEXT_RE.test(textLabel) ||
          isCommonAdSize(rect) ||
          element.matches("iframe,ins,amp-ad"))
    );
  }
  
  function isFixedOrSticky(element) {
    const style = window.getComputedStyle(element);
    return style.position === "fixed" || style.position === "sticky";
  }
  
  function hasScriptAdIframe(element) {
    const frames = element.matches("iframe")
      ? [element]
      : Array.from(element.querySelectorAll("iframe")).slice(0, 6);
  
    return frames.some((frame) => {
      if (!(frame instanceof HTMLElement)) {
        return false;
      }
  
      const sourceText = getSourceValues(frame).join(" ");
      if (!SCRIPT_IFRAME_SOURCE_RE.test(sourceText)) {
        return false;
      }
  
      const rect = frame.getBoundingClientRect();
      return (
        rect.width >= 250 &&
        rect.height >= 80 &&
        rect.height <= 340 &&
        rect.width <= Math.max(1000, window.innerWidth * 0.9)
      );
    });
  }
  
  function findBrandingTakeoverContainer(element) {
    let current = element;
    let depth = 0;
  
    while (current && current !== document.body && depth < 4) {
      if (current instanceof HTMLElement && isBrandingTakeover(current)) {
        return current;
      }
  
      current = current.parentElement;
      depth += 1;
    }
  
    return null;
  }
  
  function isBrandingTakeover(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
  
    const rect = element.getBoundingClientRect();
    const coversViewport =
      rect.width >= window.innerWidth * 0.85 &&
      rect.height >= window.innerHeight * 0.8 &&
      rect.left <= window.innerWidth * 0.1 &&
      rect.top <= window.innerHeight * 0.1;
  
    if (!coversViewport) {
      return false;
    }
  
    const identifiers = getIdentifierText(element);
    const sources = getSourceValues(element).join(" ");
    if (
      !BRANDING_TAKEOVER_IDENTIFIER_RE.test(identifiers) ||
      !BRANDING_TAKEOVER_SOURCE_RE.test(sources)
    ) {
      return false;
    }
  
    let current = element;
    let depth = 0;
  
    while (current && current !== document.body && depth < 4) {
      if (
        current instanceof HTMLElement &&
        window.getComputedStyle(current).position === "fixed"
      ) {
        return true;
      }
  
      current = current.parentElement;
      depth += 1;
    }
  
    return false;
  }
  
  function loadCosmeticRulesForPage() {
    const api = globalThis.AttentionRedirectorCosmeticFilters;
    if (!api || typeof api.getRulesForHost !== "function") {
      return [];
    }
  
    try {
      return api.getRulesForHost(location.hostname);
    } catch (_error) {
      return [];
    }
  }
  
  function getCosmeticMatch(element) {
    return state.cosmeticMatches.get(element) || null;
  }
  
  function hasCosmeticMatch(element) {
    return Boolean(getCosmeticMatch(element));
  }
  
  function hasOwnAdIdentifier(element) {
    const identifiers = getIdentifierText(element);
    return AD_IDENTIFIER_RE.test(identifiers) || VIDEO_AD_IDENTIFIER_RE.test(identifiers);
  }
  
  function containsExplicitVideoAdLayer(element) {
    return Array.from(element.querySelectorAll("[id],[class],[aria-label]")).some(
      (child) => {
        return (
          child !== element &&
          child instanceof HTMLElement &&
          VIDEO_AD_IDENTIFIER_RE.test(getIdentifierText(child))
        );
      }
    );
  }
  
  function inspectElement(element, extraReasons = []) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const identifiers = getIdentifierText(element);
    const textSnippet = getShortLabelText(element);
    const sources = getSourceValues(element);
    const reasons = [...extraReasons];
    const zIndex = Number.parseInt(style.zIndex, 10);
    const highZIndex = Number.isFinite(zIndex) && zIndex >= 100;
    const fixedOrSticky =
      style.position === "fixed" || style.position === "sticky";
    let score = extraReasons.length ? 2 : 0;
  
    if (AD_IDENTIFIER_RE.test(identifiers)) {
      score += 4;
      reasons.push("ad-like identifier");
    }
  
    if (BANNER_IDENTIFIER_RE.test(identifiers)) {
      score += 2;
      reasons.push("banner-like identifier");
    }
  
    if (AD_TEXT_RE.test(textSnippet)) {
      score += 3;
      reasons.push("ad/sponsor text");
    }
  
    if (AD_SOURCE_RE.test(sources.join(" "))) {
      score += 4;
      reasons.push("ad-like source URL");
    }
  
    const cosmeticMatch = getCosmeticMatch(element);
    if (cosmeticMatch) {
      score += 4;
      reasons.push(`cosmetic filter: ${cosmeticMatch.selector}`);
    }
  
    if (isCommonAdSize(rect)) {
      score += 2;
      reasons.push("common ad size");
    }
  
    if (isSidebarElement(element)) {
      score += 1;
      reasons.push("sidebar/rail placement");
    }
  
    if (fixedOrSticky && isVisibleRect(rect)) {
      score += 1;
      reasons.push(`${style.position} positioning`);
    }
  
    if (highZIndex) {
      score += 1;
      reasons.push("high z-index");
    }
  
    if (isPopupLike(element, style, rect, highZIndex)) {
      score += 3;
      reasons.push("popup-like overlay");
    }
  
    if (isAnimatedElement(element, style)) {
      score += 1;
      reasons.push("animated element");
    }
  
    if (hasUnsafeIdentifier(element)) {
      reasons.push("unsafe identifier present");
    }
  
    const uniqueReasons = Array.from(new Set(reasons));
  
    return {
      element,
      signature: getElementSignature(element),
      reasons: uniqueReasons,
      score,
      wouldReplace: Boolean(getMatchReason(element)),
      safetyBlocks: getSafetyBlocks(element),
      rect: {
        width: rect.width,
        height: rect.height,
        top: rect.top,
        left: rect.left,
        area: rect.width * rect.height
      },
      css: {
        position: style.position,
        zIndex: style.zIndex,
        display: style.display,
        opacity: style.opacity
      },
      role: element.getAttribute("role") || "",
      ariaLabel: element.getAttribute("aria-label") || "",
      textSnippet,
      sources,
      ancestry: getAncestry(element)
    };
  }
  
  function getSafetyBlocks(element) {
    const blocks = [];
  
    if (!element || element.dataset.attentionRedirectorReplaced === "true") {
      blocks.push("already replaced or invalid");
      return blocks;
    }
  
    if (element === document.body || element === document.documentElement) {
      blocks.push("page root");
    }
  
    if (element.matches("main,article,header,footer")) {
      blocks.push("structural page section");
    }
  
    if (containsExplicitVideoAdLayer(element) && !hasOwnAdIdentifier(element)) {
      blocks.push("contains explicit video ad child");
    }
  
    if (isExtensionElement(element)) {
      blocks.push("extension UI");
    }
  
    const strongAdSignal = hasStrongAdSignal(element);
    const explicitAdSlot = isExplicitAdSlot(element);
  
    if (hasHardUnsafeAncestor(element)) {
      blocks.push("unsafe ancestor");
    }
  
    if (hasSoftUnsafeAncestor(element) && !strongAdSignal) {
      blocks.push("unsafe ancestor");
    }
  
    if (
      (hasHardUnsafeIdentifier(element) ||
        hasHardUnsafeIdentifierInAncestors(element)) &&
      !explicitAdSlot
    ) {
      blocks.push("unsafe identifier");
    }
  
    if (
      (hasSoftUnsafeIdentifier(element) ||
        hasSoftUnsafeIdentifierInAncestors(element)) &&
      !strongAdSignal
    ) {
      blocks.push("unsafe identifier");
    }
  
    if (element.querySelector("form,input,textarea,select,[contenteditable='true']")) {
      blocks.push("contains form/editor controls");
    }
  
    if (element.closest("a[href]") && !hasAdLikeSource(element)) {
      blocks.push("inside normal link");
    }
  
    const rect = element.getBoundingClientRect();
    if (!isVisibleRect(rect)) {
      blocks.push("not visibly sized");
    }
  
    if (isTooLargeForMvp(rect) && !canReplaceExplicitLargeAd(element, rect)) {
      blocks.push("too large for normal replacement");
    }
  
    return Array.from(new Set(blocks));
  }
  
  function isExtensionElement(element) {
    return Boolean(
      element.closest(
        ".attention-redirector-slot,.attention-redirector-card,.attention-redirector-inspector,.attention-redirector-inspector-box,.attention-redirector-manual-hover,.attention-redirector-manual-capture"
      )
    );
  }
  
  function isPopupLike(element, style, rect, highZIndex) {
    if (style.position !== "fixed") {
      return false;
    }
  
    const viewportArea = window.innerWidth * window.innerHeight;
    const area = rect.width * rect.height;
    const largeEnough = rect.width >= 220 && rect.height >= 110;
    const centered =
      rect.left > 20 &&
      rect.top > 20 &&
      rect.right < window.innerWidth - 20 &&
      rect.bottom < window.innerHeight - 20;
  
    return (
      largeEnough &&
      area >= viewportArea * 0.06 &&
      (highZIndex || centered || hasCloseControl(element))
    );
  }
  
  function hasCloseControl(element) {
    const controls = Array.from(
      element.querySelectorAll("button,a,[role='button'],[aria-label],[title]")
    ).slice(0, 20);
  
    return controls.some((control) => {
      const label = [
        control.textContent,
        control.getAttribute("aria-label"),
        control.getAttribute("title")
      ]
        .filter(Boolean)
        .join(" ")
        .trim()
        .toLowerCase();
  
      return /(^|\b)(close|dismiss|hide|no thanks|not now|skip)(\b|$)|^x$/.test(
        label
      );
    });
  }
  
  function isAnimatedElement(element, style) {
    const hasAnimation =
      style.animationName &&
      style.animationName !== "none" &&
      parseCssTime(style.animationDuration) > 0;
    const hasTransition = parseCssTime(style.transitionDuration) > 0;
  
    if (hasAnimation || hasTransition) {
      return true;
    }
  
    if (typeof element.getAnimations !== "function") {
      return false;
    }
  
    try {
      return element.getAnimations({ subtree: true }).some((animation) => {
        const target = animation.effect && animation.effect.target;
        const targetElement =
          target instanceof Element
            ? target
            : target && target.element instanceof Element
              ? target.element
              : null;
  
        return !targetElement || !isExtensionElement(targetElement);
      });
    } catch (_error) {
      return false;
    }
  }
  
  function parseCssTime(value) {
    return String(value || "")
      .split(",")
      .map((part) => part.trim())
      .reduce((max, part) => {
        if (part.endsWith("ms")) {
          return Math.max(max, Number.parseFloat(part) || 0);
        }
  
        if (part.endsWith("s")) {
          return Math.max(max, (Number.parseFloat(part) || 0) * 1000);
        }
  
        return max;
      }, 0);
  }
  
  function isPageAllowed(settings) {
    if (!settings || !settings.enabled) {
      return false;
    }
  
    if (isSensitivePage()) {
      return false;
    }
  
    return !isDomainDisabled(location.hostname, settings.disabledDomains);
  }
  
  function isSensitivePage() {
    const host = location.hostname.toLowerCase();
    const normalizedHost = stripWww(host);
  
    if (
      SENSITIVE_DOMAINS.some((domain) => {
        return normalizedHost === domain || normalizedHost.endsWith(`.${domain}`);
      })
    ) {
      return true;
    }
  
    if (SENSITIVE_HOST_WORDS.some((word) => normalizedHost.includes(word))) {
      return true;
    }
  
    if (SENSITIVE_PATH_RE.test(location.pathname)) {
      return true;
    }
  
    if (document.body && document.body.isContentEditable) {
      return true;
    }
  
    return hasVisiblePasswordInput();
  }
  
  function hasVisiblePasswordInput() {
    return Array.from(document.querySelectorAll("input[type='password']")).some(
      (input) => {
        if (!(input instanceof HTMLElement)) {
          return false;
        }
  
        if (input.disabled || input.type === "hidden") {
          return false;
        }
  
        const rect = input.getBoundingClientRect();
        const style = window.getComputedStyle(input);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number.parseFloat(style.opacity || "1") > 0
        );
      }
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
  
  
  function replaceCandidate(element) {
    if (!safeToReplace(element)) {
      return false;
    }
  
    const rect = element.getBoundingClientRect();
    const minHeight = Math.max(48, Math.round(rect.height));
    const slot = createReplacementSlot(element, rect);
    const surfaceKey = createSurfaceKey(element, rect);
    const preservesSiteChildren = slot === element;
  
    slot.dataset.attentionRedirectorReplaced = "true";
    slot.dataset.attentionRedirectorSurfaceKey = surfaceKey;
    slot.dataset.attentionRedirectorWidth = String(Math.round(rect.width));
    slot.dataset.attentionRedirectorHeight = String(Math.round(rect.height));
    slot.classList.add("attention-redirector-slot");
    slot.classList.toggle(
      "attention-redirector-slot--preserve-children",
      preservesSiteChildren
    );
    slot.setAttribute("aria-label", "Attention Redirector replacement");
    slot.style.minHeight = `${minHeight}px`;
  
    if (rect.width > 0 && rect.width < 420) {
      slot.classList.add("attention-redirector-slot--narrow");
    }
  
    if (rect.height < 90) {
      slot.classList.add("attention-redirector-slot--short");
    }
  
    renderReplacementSlot(slot);
    return true;
  }
  
  function applySettingsToReplacedSlots() {
    document.querySelectorAll(".attention-redirector-slot").forEach((slot) => {
      if (slot instanceof HTMLElement) {
        renderReplacementSlot(slot);
      }
    });
  }
  
  function renderReplacementSlot(slot) {
    const width = Number.parseFloat(slot.dataset.attentionRedirectorWidth || "0");
    const height = Number.parseFloat(slot.dataset.attentionRedirectorHeight || "0");
    const rect = {
      width: width || slot.getBoundingClientRect().width,
      height: height || slot.getBoundingClientRect().height
    };
    const surfaceKey =
      slot.dataset.attentionRedirectorSurfaceKey ||
      createSurfaceKey(slot, slot.getBoundingClientRect());
    const existingGuard = state.replacementGuards.get(slot);
    const preservesSiteChildren = slot.classList.contains(
      "attention-redirector-slot--preserve-children"
    );
  
    if (!isPageAllowed(state.settings) || !shouldVisualizeSurface(surfaceKey)) {
      if (existingGuard) {
        existingGuard.disconnect();
        state.replacementGuards.delete(slot);
      }
      slot.dataset.attentionRedirectorPresentation = "clean";
      removeReplacementCards(slot);
      slot.style.display = "none";
      return;
    }
  
    slot.style.removeProperty("display");
    slot.dataset.attentionRedirectorPresentation = "ambient";
    const card = buildCard(createCardModel(surfaceKey), rect);
    removeReplacementCards(slot);
    if (preservesSiteChildren) {
      slot.append(card);
    } else {
      slot.replaceChildren(card);
    }
    observeCardMotion(card);
    installReplacementGuard(slot, card);
  }
  
  function removeReplacementCards(slot) {
    slot
      .querySelectorAll(":scope > .attention-redirector-card")
      .forEach((card) => {
        if (state.motionObserver) {
          state.motionObserver.unobserve(card);
        }
        card.remove();
      });
  }
  
  function observeCardMotion(card) {
    if (
      state.settings.reducedMotion === "still" ||
      typeof IntersectionObserver !== "function"
    ) {
      return;
    }
  
    if (!state.motionObserver) {
      state.motionObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            entry.target.classList.toggle(
              "attention-redirector-card--motion-paused",
              !entry.isIntersecting
            );
          });
        },
        {
          rootMargin: "700px 0px",
          threshold: 0
        }
      );
    }
  
    card.classList.add("attention-redirector-card--motion-paused");
    state.motionObserver.observe(card);
  }
  
  function shouldVisualizeSurface(surfaceKey) {
    const presence = state.settings.visualPresence;
    if (presence <= 0) {
      return false;
    }
    if (presence >= 10) {
      return true;
    }
    return hashString(surfaceKey) % 10 < presence;
  }
  
  function createSurfaceKey(element, rect) {
    return [
      location.hostname,
      location.pathname,
      getElementSignature(element),
      Math.round(rect.left || 0),
      Math.round(rect.top || 0),
      Math.round(rect.width || 0),
      Math.round(rect.height || 0)
    ].join(":");
  }
  
  function installReplacementGuard(slot, card) {
    const existingGuard = state.replacementGuards.get(slot);
    if (existingGuard) {
      existingGuard.disconnect();
    }
  
    const preservesSiteChildren = slot.classList.contains(
      "attention-redirector-slot--preserve-children"
    );
    let restoring = false;
    const restoreCard = () => {
      if (restoring || !slot.isConnected || slot.style.display === "none") {
        return;
      }
  
      const cardIsPresent = card.parentElement === slot;
      const cardIsOnlyChild =
        cardIsPresent &&
        slot.children.length === 1 &&
        slot.firstElementChild === card;
      const markersArePresent =
        slot.classList.contains("attention-redirector-slot") &&
        (!preservesSiteChildren ||
          slot.classList.contains(
            "attention-redirector-slot--preserve-children"
          ));
      if (
        markersArePresent &&
        (preservesSiteChildren ? cardIsPresent : cardIsOnlyChild)
      ) {
        return;
      }
  
      restoring = true;
      slot.dataset.attentionRedirectorReplaced = "true";
      slot.classList.add("attention-redirector-slot");
      slot.classList.toggle(
        "attention-redirector-slot--preserve-children",
        preservesSiteChildren
      );
      if (preservesSiteChildren) {
        if (!cardIsPresent) {
          removeReplacementCards(slot);
          slot.append(card);
        }
      } else {
        slot.replaceChildren(card);
      }
      restoring = false;
    };
  
    const observer = new MutationObserver(restoreCard);
    observer.observe(slot, {
      attributes: true,
      attributeFilter: ["class"],
      childList: true,
      subtree: false
    });
    state.replacementGuards.set(slot, observer);
  }
  
  function createReplacementSlot(element, rect) {
    if (!element.matches("iframe,img,embed,amp-ad")) {
      return element;
    }
  
    const wrapper = document.createElement("div");
    wrapper.style.width = `${Math.max(120, Math.round(rect.width))}px`;
    wrapper.style.maxWidth = "100%";
    wrapper.style.height = `${Math.max(40, Math.round(rect.height))}px`;
    element.replaceWith(wrapper);
    return wrapper;
  }
  
  function buildCard(cardModel, rect) {
    const card = document.createElement("div");
    card.className = "attention-redirector-card";
    card.dataset.mode = cardModel.mode;
    card.dataset.ambientVariant = "tide";
    card.style.setProperty("--ar-motion-delay", `${cardModel.motionDelay}s`);
    card.classList.toggle(
      "attention-redirector-card--still",
      state.settings.reducedMotion === "still"
    );
    card.setAttribute("role", "group");
    card.setAttribute(
      "aria-label",
      cardModel.mode === "anchor"
        ? `Attention anchor: ${cardModel.body}`
        : "Quiet attention replacement"
    );
  
    if (rect.width < 260 || rect.height < 110) {
      card.classList.add("attention-redirector-card--compact");
    }
  
    const hideButton = document.createElement("button");
    hideButton.type = "button";
    hideButton.className = "attention-redirector-card__hide";
    hideButton.textContent = "×";
    hideButton.setAttribute("aria-label", "Hide this Attention Redirector card");
    hideButton.addEventListener("click", () => {
      const slot = card.closest(".attention-redirector-slot");
      if (slot) {
        slot.style.display = "none";
      }
    });
  
    card.append(hideButton);
  
    if (cardModel.mode === "anchor") {
      const body = document.createElement("div");
      body.className = "attention-redirector-card__body";
      body.textContent = cardModel.body;
      card.append(body);
    }
  
    return card;
  }
  
  function createCardModel(surfaceKey) {
    const sequence = state.cardSequence;
    state.cardSequence += 1;
  
    return {
      mode: state.settings.mode,
      body: state.settings.anchorNote,
      motionDelay: -(((hashString(surfaceKey) + sequence) % 6) * 5)
    };
  }
  
  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x85ebca6b);
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0xc2b2ae35);
    return (hash ^ (hash >>> 16)) >>> 0;
  }
  
  function getIdentifierText(element) {
    const parts = [
      element.id,
      element.className,
      element.getAttribute("aria-label"),
      element.getAttribute("data-testid"),
      element.getAttribute("data-ad-slot"),
      element.getAttribute("data-ad-client"),
      element.localName
    ];
  
    return parts.filter(Boolean).join(" ").toLowerCase();
  }
  
  function getElementSignature(element) {
    const tag = element.localName || "element";
    const id = element.id ? `#${element.id}` : "";
    const classes = Array.from(element.classList || [])
      .filter((className) => !className.startsWith("attention-redirector"))
      .slice(0, 6)
      .map((className) => `.${className}`)
      .join("");
  
    return `${tag}${id}${classes}`;
  }
  
  function getAncestry(element) {
    const ancestry = [];
    let current = element;
    let depth = 0;
  
    while (current && current !== document.body && depth < 6) {
      if (current instanceof HTMLElement) {
        ancestry.unshift(getElementSignature(current));
      }
      current = current.parentElement;
      depth += 1;
    }
  
    return ancestry;
  }
  
  function getShortLabelText(element) {
    const ownText = Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join(" ");
  
    const labelText = [
      ownText,
      element.getAttribute("aria-label"),
      element.getAttribute("title")
    ]
      .filter(Boolean)
      .join(" ");
  
    if (labelText.trim().length > 0) {
      return labelText.slice(0, 240);
    }
  
    return element.textContent ? element.textContent.trim().slice(0, 240) : "";
  }
  
  function hasAdLikeSource(element) {
    const srcValues = Array.from(
      element.querySelectorAll("iframe,img,embed,source")
    )
      .map((node) => {
        return [
          node.getAttribute("src"),
          node.getAttribute("data-src"),
          node.getAttribute("srcdoc")
        ]
          .filter(Boolean)
          .join(" ");
      })
      .join(" ");
  
    const ownSrc = [
      element.getAttribute("src"),
      element.getAttribute("data-src"),
      element.getAttribute("srcdoc")
    ]
      .filter(Boolean)
      .join(" ");
  
    return AD_SOURCE_RE.test(`${ownSrc} ${srcValues}`);
  }
  
  function getSourceValues(element) {
    const nodes = [element, ...Array.from(element.querySelectorAll("iframe,img,embed,source"))];
    const values = [];
  
    nodes.slice(0, 12).forEach((node) => {
      ["src", "data-src", "srcdoc"].forEach((attribute) => {
        const value = node.getAttribute(attribute);
        if (value) {
          values.push(truncateMiddle(value.trim(), 180));
        }
      });
    });
  
    return Array.from(new Set(values)).slice(0, 8);
  }
  
  function truncateMiddle(value, maxLength) {
    if (value.length <= maxLength) {
      return value;
    }
  
    const half = Math.floor((maxLength - 3) / 2);
    return `${value.slice(0, half)}...${value.slice(-half)}`;
  }
  
  function hasUnsafeIdentifier(element) {
    return UNSAFE_IDENTIFIER_RE.test(getIdentifierText(element));
  }
  
  function hasHardUnsafeIdentifier(element) {
    return HARD_UNSAFE_IDENTIFIER_RE.test(getIdentifierText(element));
  }
  
  function hasSoftUnsafeIdentifier(element) {
    return SOFT_UNSAFE_IDENTIFIER_RE.test(getIdentifierText(element));
  }
  
  function hasUnsafeIdentifierInAncestors(element) {
    let current = element.parentElement;
  
    while (current && current !== document.body) {
      if (UNSAFE_IDENTIFIER_RE.test(getIdentifierText(current))) {
        return true;
      }
  
      current = current.parentElement;
    }
  
    return false;
  }
  
  function hasHardUnsafeIdentifierInAncestors(element) {
    let current = element.parentElement;
  
    while (current && current !== document.body) {
      if (HARD_UNSAFE_IDENTIFIER_RE.test(getIdentifierText(current))) {
        return true;
      }
  
      current = current.parentElement;
    }
  
    return false;
  }
  
  function hasSoftUnsafeIdentifierInAncestors(element) {
    let current = element.parentElement;
  
    while (current && current !== document.body) {
      if (SOFT_UNSAFE_IDENTIFIER_RE.test(getIdentifierText(current))) {
        return true;
      }
  
      current = current.parentElement;
    }
  
    return false;
  }
  
  function hasHardUnsafeAncestor(element) {
    return Boolean(element.closest(HARD_UNSAFE_ANCESTOR_SELECTOR));
  }
  
  function hasSoftUnsafeAncestor(element) {
    return Boolean(element.closest(SOFT_UNSAFE_ANCESTOR_SELECTOR));
  }
  
  function isVisibleRect(rect) {
    return rect.width >= 120 && rect.height >= 40;
  }
  
  function isSmallContainer(rect) {
    return rect.width <= 420 || rect.height <= 320;
  }
  
  function isTooLargeForMvp(rect) {
    const viewportArea = window.innerWidth * window.innerHeight;
    const area = rect.width * rect.height;
  
    if (area > viewportArea * 0.35) {
      return true;
    }
  
    if (rect.width > window.innerWidth * 0.94 && rect.height > 260) {
      return true;
    }
  
    return false;
  }
  
  function canReplaceExplicitLargeAd(element, rect) {
    return hasStrongAdSignal(element) && !isTooLargeForExplicitAd(rect);
  }
  
  function isTooLargeForExplicitAd(rect) {
    const viewportArea = window.innerWidth * window.innerHeight;
    const area = rect.width * rect.height;
  
    if (area > viewportArea * 0.9) {
      return true;
    }
  
    if (rect.width > window.innerWidth * 0.98 && rect.height > window.innerHeight * 0.85) {
      return true;
    }
  
    if (rect.height > Math.max(760, window.innerHeight * 1.2)) {
      return true;
    }
  
    return false;
  }
  
  function isTooLargeForInspector(rect, element) {
    const viewportArea = window.innerWidth * window.innerHeight;
    const area = rect.width * rect.height;
  
    if (area <= viewportArea * 0.85) {
      return false;
    }
  
    if (!element) {
      return true;
    }
  
    const style = window.getComputedStyle(element);
    return style.position !== "fixed" && style.position !== "sticky";
  }
  
  function isCommonAdSize(rect) {
    return COMMON_AD_SIZES.some(([width, height]) => {
      const widthDelta = Math.abs(rect.width - width);
      const heightDelta = Math.abs(rect.height - height);
      return widthDelta <= 32 && heightDelta <= 28;
    });
  }
  
  function isSidebarElement(element) {
    return Boolean(
      element.closest("aside,[role='complementary']") ||
        /(^|[\s_.:-])(sidebar|rail|right-column|rightcol)([\s_.:-]|$)/i.test(
          getIdentifierText(element.parentElement || element)
        )
    );
  }
  
  function isLikelyHeroBanner(element) {
    const identifiers = getIdentifierText(element);
    const rect = element.getBoundingClientRect();
  
    return (
      /(^|[\s_.:-])(hero|masthead|site-banner|brand-banner)([\s_.:-]|$)/i.test(
        identifiers
      ) ||
      (rect.width > window.innerWidth * 0.75 && rect.height > 180)
    );
  }
  
  function hasSimilarRect(child, parent) {
    const childRect = child.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
  
    if (!isVisibleRect(childRect) || !isVisibleRect(parentRect)) {
      return false;
    }
  
    return (
      Math.abs(childRect.width - parentRect.width) <= 48 &&
      Math.abs(childRect.height - parentRect.height) <= 48
    );
  }
  
  function getArea(element) {
    const rect = element.getBoundingClientRect();
    return rect.width * rect.height;
  }
  
  init();
  
})();
