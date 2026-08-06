(() => {
  const CONTENT_LOADED_KEY = "__attentionRedirectorContentLoaded";
  if (window[CONTENT_LOADED_KEY]) {
    return;
  }
  window[CONTENT_LOADED_KEY] = true;

  const STORAGE_KEY = "attentionRedirectorSettings";
  const INSPECTOR_REPORTS_KEY = "attentionRedirectorInspectorReports";
  const DEFAULT_ANCHOR_NOTE = "Finish what deserves your attention.";
  const MAX_ANCHOR_NOTES = 5;

  const DEFAULT_SETTINGS = {
    enabled: true,
    mode: "quiet",
    anchorNote: DEFAULT_ANCHOR_NOTE,
    anchorNotes: [DEFAULT_ANCHOR_NOTE],
    visualPresence: 10,
    reducedMotion: "system",
    disabledDomains: []
  };

  function normalizeAnchorNotes(...sources) {
    const notes = [];

    sources.forEach((source) => {
      const values = Array.isArray(source) ? source : [source];
      values.forEach((value) => {
        const note = String(value || "").trim();
        if (note && !notes.includes(note)) {
          notes.push(note);
        }
      });
    });

    return notes.length ? notes.slice(0, MAX_ANCHOR_NOTES) : [DEFAULT_ANCHOR_NOTE];
  }

  function hasAnchorNoteInput(value) {
    if (Array.isArray(value)) {
      return value.some(hasAnchorNoteInput);
    }
    return typeof value === "string" && Boolean(value.trim());
  }

  const SENSITIVE_DOMAINS = [
    "accounts.google.com",
    "docs.google.com",
    "drive.google.com",
    "mail.google.com",
    "inbox.google.com",
    "calendar.google.com",
    "notion.so",
    "notion.com",
    "figma.com",
    "canva.com",
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

  const DOM_REPLACEMENT_DISABLED_DOMAINS = [
    "linkedin.com",
    "youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "translate.google.com"
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
    // Dropdowns may be portaled outside header/nav and inherit ad evidence from a child.
    "[role='menu']",
    "[role='menubar']",
    "[role='listbox']",
    "[role='search']",
    "[role='form']",
    "[class*='dropdown']",
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
    "aside img",
    "[role='complementary'] img",
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

  const MUTATION_SCAN_TRIGGER_SELECTOR = [
    "iframe",
    "ins",
    "amp-ad",
    "shreddit-ad-post",
    "ytd-ad-slot-renderer",
    "ytd-display-ad-renderer",
    "ytd-promoted-sparkles-web-renderer",
    "[data-ad-slot]",
    "[data-ad-client]",
    "[src]",
    "[data-src]",
    "[id]",
    "[class]",
    "[aria-label]",
    "[title]"
  ].join(",");

  const MUTATION_AD_SIGNAL_RE =
    /(^|[\s_.:-])(ad|ads|adslot|ad-slot|advert|advertisement|advertising|sponsor|sponsored|promoted|dfp|gpt|doubleclick|adsbygoogle|taboola|outbrain|mgid|teads|ima|vast|vpaid|banner)([\s_.:-]|$)/i;

  const LARGE_DOM_ZERO_SCAN_THRESHOLD = 2500;
  const MUTATION_DESCENDANT_SCAN_LIMIT = 80;

  const SHADOW_ROOT_STYLE_TEXT = `
  .attention-redirector-slot {
    box-sizing: border-box !important;
    isolation: isolate !important;
  }
  .attention-redirector-slot--preserve-children {
    position: relative !important;
    overflow: hidden !important;
  }
  .attention-redirector-slot--preserve-children > :not(.attention-redirector-card) {
    opacity: 0 !important;
    pointer-events: none !important;
  }
  .attention-redirector-slot--preserve-children > .attention-redirector-card {
    position: absolute !important;
    inset: 0 !important;
    z-index: 2147483646 !important;
    min-height: 0 !important;
  }
  .attention-redirector-card,
  .attention-redirector-card *,
  .attention-redirector-card *::before,
  .attention-redirector-card *::after {
    box-sizing: border-box !important;
  }
  .attention-redirector-card {
    --ar-field-a: #d9e4d8;
    --ar-field-b: #adc2ae;
    --ar-field-c: #496555;
    --ar-ink: #183027;
    --ar-motion-delay: 0s;
    position: relative !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    isolation: isolate !important;
    contain: paint !important;
    width: 100% !important;
    min-height: inherit !important;
    height: 100% !important;
    padding: clamp(22px, 6vw, 64px) !important;
    overflow: hidden !important;
    border: 0 !important;
    border-radius: 16px !important;
    background: linear-gradient(145deg, var(--ar-field-a), var(--ar-field-b)) !important;
    color: var(--ar-ink) !important;
    font-family: Optima, Candara, "Trebuchet MS", sans-serif !important;
    line-height: 1.08 !important;
    text-align: center !important;
    white-space: normal !important;
    word-break: normal !important;
    hyphens: none !important;
    text-indent: 0 !important;
    text-transform: none !important;
    writing-mode: horizontal-tb !important;
    text-orientation: mixed !important;
    font-style: normal !important;
    font-variant: normal !important;
    -webkit-text-fill-color: currentColor !important;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.48), 0 10px 32px rgba(73, 101, 85, 0.16) !important;
  }
  .attention-redirector-card::before,
  .attention-redirector-card::after {
    content: "" !important;
    position: absolute !important;
    z-index: 0 !important;
    display: block !important;
    pointer-events: none !important;
  }
  .attention-redirector-card[data-ambient-variant="tide"]::before {
    inset: -55% -20% !important;
    border-radius: 44% !important;
    background: linear-gradient(115deg, rgba(255, 255, 255, 0.24) 0%, rgba(217, 228, 216, 0.08) 42%, rgba(73, 101, 85, 0.2) 72%, rgba(255, 255, 255, 0.18) 100%) !important;
    animation: attention-redirector-tide 32s ease-in-out infinite alternate !important;
    animation-delay: var(--ar-motion-delay) !important;
  }
  .attention-redirector-card[data-ambient-variant="tide"]::after {
    right: -18% !important;
    bottom: -55% !important;
    width: 66% !important;
    aspect-ratio: 1 !important;
    border-radius: 50% !important;
    background: radial-gradient(circle, rgba(217, 104, 58, 0.18) 0%, rgba(217, 104, 58, 0.12) 42%, rgba(217, 104, 58, 0) 72%) !important;
    animation: attention-redirector-tide-orb 30s ease-in-out infinite alternate !important;
    animation-delay: var(--ar-motion-delay) !important;
  }
  .attention-redirector-card__hide {
    appearance: none !important;
    position: absolute !important;
    top: 8px !important;
    right: 8px !important;
    z-index: 3 !important;
    display: grid !important;
    place-items: center !important;
    width: 26px !important;
    height: 26px !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    border-radius: 50% !important;
    background: transparent !important;
    color: currentColor !important;
    cursor: pointer !important;
    font-family: Arial, sans-serif !important;
    font-size: 18px !important;
    line-height: 1 !important;
    opacity: 0.28 !important;
  }
  .attention-redirector-card__body {
    position: relative !important;
    z-index: 2 !important;
    display: -webkit-box !important;
    max-width: 820px !important;
    margin: 0 !important;
    color: var(--ar-ink) !important;
    font: inherit !important;
    font-size: var(--ar-card-font, clamp(22px, 3.7vw, 46px)) !important;
    font-weight: 500 !important;
    letter-spacing: -0.035em !important;
    line-height: 1.08 !important;
    overflow-wrap: anywhere !important;
    -webkit-box-orient: vertical !important;
    -webkit-line-clamp: var(--ar-card-lines, 3) !important;
    overflow: hidden !important;
  }
  .attention-redirector-card--compact {
    padding: 12px 34px 12px 16px !important;
    border-radius: 10px !important;
  }
  .attention-redirector-slot--short .attention-redirector-card {
    padding: 7px 36px 7px 14px !important;
    border-radius: 8px !important;
  }
  .attention-redirector-slot--narrow .attention-redirector-card {
    text-align: left !important;
  }
  .attention-redirector-slot--narrow .attention-redirector-card__body,
  .attention-redirector-slot--tall .attention-redirector-card__body {
    width: 100% !important;
  }
  .attention-redirector-slot--tall .attention-redirector-card__body {
    line-height: 1.14 !important;
  }
  .attention-redirector-card--still,
  .attention-redirector-card--still[data-ambient-variant]::before,
  .attention-redirector-card--still[data-ambient-variant]::after,
  .attention-redirector-card--motion-paused[data-ambient-variant]::before,
  .attention-redirector-card--motion-paused[data-ambient-variant]::after {
    animation: none !important;
  }
  @keyframes attention-redirector-tide {
    0% { transform: translate3d(-3%, -2%, 0) rotate(0deg) scale(1); }
    100% { transform: translate3d(3%, 2%, 0) rotate(5deg) scale(1.04); }
  }
  @keyframes attention-redirector-tide-orb {
    0% { transform: translate3d(0, 0, 0) scale(1); }
    100% { transform: translate3d(-18%, -6%, 0) scale(1.08); }
  }
  `;

  const INSPECTOR_MAX_HIGHLIGHTS = 35;
  const INSPECTOR_MAX_REPORT_CANDIDATES = 20;
  const INSPECTOR_MAX_SAVED_REPORTS = 75;

  const REPORT_URL_WITHHELD = "(unparseable page URL withheld)";

  // A report is written to be pasted into a public issue, so the page URL is cut
  // back to origin plus path first. A query string carries session tokens, search
  // terms and order numbers far more often than it carries anything a triager
  // needs, and the reporter cannot un-publish it afterwards. The removal is
  // labelled rather than silent so they can paste back the part that mattered.
  function formatReportUrl(href) {
    let parsed;
    try {
      parsed = new URL(href);
    } catch (error) {
      return REPORT_URL_WITHHELD;
    }

    const dropped = [];
    if (parsed.search) {
      dropped.push("query");
    }
    if (parsed.hash) {
      dropped.push("fragment");
    }

    const base = `${parsed.origin}${parsed.pathname}`;
    return dropped.length ? `${base} (${dropped.join(" and ")} removed)` : base;
  }

  const AD_IDENTIFIER_RE =
    /(^|[\s_.:-])(ad|ads|adslot|ad-slot|ad_unit|ad-unit|advert|advertisement|advertising|sponsor|sponsored|promoted|dfp|gpt|doubleclick|adsbygoogle|native-ad|paid-placement|taboola|outbrain|mgid)([\s_.:-]|$)/i;

  const VIDEO_AD_IDENTIFIER_RE =
    /(^|[\s_.:-])(ima-ad-container|ad-container|ad_container|ima|vast|vpaid|preroll|pre-roll|midroll|mid-roll)([\s_.:-]|$)/i;

  const BANNER_IDENTIFIER_RE =
    /(^|[\s_.:-])(banner|leaderboard)([\s_.:-]|$)/i;

  const UNSAFE_IDENTIFIER_RE =
    /(comment|comments|reply|discussion|thread|editor|compose|message|chat|checkout|cart|basket|payment|billing|invoice|login|signin|password|cookie|consent|privacy|modal|dialog|toast|navigation|menu|navbar|breadcrumb|footer|header|search|subscribe|newsletter|cite_note|cite_ref|footnote)/i;

  const HARD_UNSAFE_IDENTIFIER_RE =
    /(comment|comments|reply|discussion|thread|editor|compose|message|chat|checkout|cart|basket|payment|billing|invoice|login|signin|password|cookie|consent|privacy|navigation|menu|navbar|breadcrumb|search|subscribe|newsletter|cite_note|cite_ref|footnote)/i;

  const SOFT_UNSAFE_IDENTIFIER_RE =
    /(modal|dialog|toast|footer|header)/i;

  // Full-string label match (not substring): editorial text that merely mentions
  // advertising must not condemn its container. See DECISIONS.md 2026-07-03.
  const AD_LABEL_MAX_LENGTH = 64;

  const AD_LABEL_RE = new RegExp(
    "^(?:" +
      [
        "ads?",
        "advert",
        "advertisements?",
        "advertisement[ \\u2013-]+continue reading below",
        "sponsored",
        "sponsored (?:content|post|story|stories|links?|results?)",
        "sponsored by [\\w .,'\\u2019&-]{1,40}",
        "ads? by [\\w .,'\\u2019&-]{1,40}",
        "paid (?:content|post|placement|partnership)",
        "promoted",
        "promoted (?:content|post|story|stories|links?)",
        "promoted by [\\w .,'\\u2019&-]{1,40}",
        "реклама",
        "на правах реклами",
        "на правах рекламы",
        "рекламний матеріал",
        "рекламный материал"
      ].join("|") +
      ")[.:]?$",
    "i"
  );

  // The floor that makes an element big enough for the scanner to rule on.
  const VISIBLE_MIN_WIDTH = 120;
  const VISIBLE_MIN_HEIGHT = 40;

  // A wrapper under that floor is not a slot the scanner can see, but it is still
  // the marker for one, because a blocked creative leaves the wrapper behind at
  // the height of its caption. The width floor is the same one, so a collapsed
  // sliver of a sidebar tile is not mistaken for the remains of a full banner.
  const AD_RESIDUE_MAX_HEIGHT = VISIBLE_MIN_HEIGHT;
  const AD_RESIDUE_MIN_WIDTH = VISIBLE_MIN_WIDTH;

  const AD_OVERLAY_MIN_HEIGHT = VISIBLE_MIN_HEIGHT;

  // Three levels is what The Sun needs (wrapper -> section container -> module).
  // Deeper walks start meeting page-level containers, which the emptiness guard
  // rejects anyway; the cap is there so a deeply nested empty tree cannot make the
  // walk expensive.
  const AD_RESIDUE_MAX_DEPTH = 3;

  const AD_RESIDUE_CONTENT_SELECTOR =
    "iframe,img,video,canvas,picture,svg,embed,object,form,input,textarea,select,a[href],[contenteditable='true']";

  const AD_RESIDUE_STOP_SELECTOR = "html,body,main,article,nav,header,footer,form";

  const AD_RESIDUE_WRAPPER_SELECTOR = "div,section,aside,ins";

  const PROSE_FLOW_SELECTOR = "li,p,blockquote,figcaption,cite,dd,dt,td,th";

  // Measured, not guessed: the citation this guard exists for holds one link, an
  // adblock-tester's description paragraph holds nothing, and the commerce tiles
  // it must not touch hold ten to fourteen elements each.
  const PROSE_MAX_ELEMENTS = 3;

  // A sponsored slot waiting to hydrate shows its own markup as text, so it reads
  // as one long paragraph with a single child — indistinguishable from prose by
  // length or structure. Markup in the text is what gives it away.
  const MARKUP_AS_TEXT_RE = /<[a-z][a-z0-9]*[\s>/]|\w+=["']/i;

  const AD_MEDIA_SELECTOR =
    "iframe,img,picture,video,canvas,ins,embed,object,amp-ad";

  const AD_SOURCE_RE =
    /(doubleclick|googlesyndication|googleadservices|adservice|adserver|adsystem|taboola|outbrain|criteo|rubiconproject|openx|pubmatic|adnxs|adsbygoogle|imasdk|ima3|vast|vpaid|schulist\.link|bidmatic|adtelligent|mgid|rcvlink|onetag-sys|lijit|mfadsrvr|360yield|id5-sync|zfctrack)/i;

  const AD_SCRIPT_TEXT_RE =
    /(googletag|div-gpt-ad|slotRenderEnded|prebid|bidmatic|mgid|collectCommercialData|rcvlink)/i;

  const SCRIPT_IFRAME_SOURCE_RE =
    /(javascript:void|document\.write|document\.createElement\(['"]script|script\.innerHTML|script\.src)/i;

  const FULL_PAGE_TAKEOVER_REASON = "full-page branding takeover";

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
    zeroScanStreak: 0,
    lastScanCandidateCount: 0,
    observer: null,
    pendingScanNodes: new Set(),
    observedScanRoots: new WeakSet(),
    shadowStyleRoots: new WeakSet(),
    dnrAllowSync: {
      timer: 0,
      nextAttempt: 0
    },
    isScanning: false,
    cardSequence: 0,
    cosmeticRules: [],
    domainCosmeticRules: [],
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
      reportMode: false,
      clickHandler: null,
      pointerMoveHandler: null,
      refreshHandler: null,
      refreshTimer: 0
    }
  };

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

    startObserver();
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

      window.requestAnimationFrame(() => {
        runScan({ force: false, contextNodes });
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
      inspectorReportMode: false,
      inspectorCandidateCount: state.inspector.candidates.length
    };
  }

  function startMissedAdReport() {
    if (state.inspector.active && state.inspector.reportMode) {
      stopInspector();
      return {
        inspectorActive: false,
        inspectorReportMode: false,
        inspectorCandidateCount: 0
      };
    }

    if (state.inspector.active) {
      stopInspector();
    }

    if (isSensitivePage()) {
      return {
        inspectorActive: false,
        inspectorReportMode: false,
        inspectorCandidateCount: 0,
        inspectorError: "Report flow is skipped on sensitive pages."
      };
    }

    startInspector({ reportMode: true, manualPick: true });
    return {
      inspectorActive: true,
      inspectorReportMode: true,
      inspectorCandidateCount: state.inspector.candidates.length
    };
  }

  function startInspector(options = {}) {
    if (state.inspector.active || !document.documentElement) {
      return;
    }

    state.inspector.active = true;
    state.inspector.reportMode = Boolean(options.reportMode);
    state.inspector.manualPick = Boolean(options.manualPick);
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
    if (state.inspector.manualPick) {
      ensureManualCaptureLayer();
      updateInspectorOverlay();
    }
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
    state.inspector.reportMode = false;
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
    overlay.dataset.attentionRedirectorReportMode = String(
      state.inspector.reportMode
    );

    const header = document.createElement("div");
    header.className = "attention-redirector-inspector__header";

    const titleBlock = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = state.inspector.reportMode
      ? "Report missed ad"
      : "Diagnostic inspector";
    const subtitle = document.createElement("span");
    subtitle.textContent = state.inspector.reportMode
      ? "Click the missed ad. A local report will be copied."
      : "Click a missed banner, popup, or animated slot.";
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

    if (state.inspector.reportMode) {
      saveCopyButton.textContent = "Copy report";
      actions.append(saveCopyButton, copyStatus, savedCount);
    } else {
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
    }
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
          if (state.inspector.reportMode) {
            saveAndCopyInspectorReport({ auto: true });
          }
        } else if (
          label.dataset.attentionRedirectorSelected === "true" &&
          state.inspector.selectedInfo
        ) {
          selectInspectorCandidate(state.inspector.selectedInfo);
          if (state.inspector.reportMode) {
            saveAndCopyInspectorReport({ auto: true });
          }
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
    if (state.inspector.reportMode) {
      saveAndCopyInspectorReport({ auto: true });
    }
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

    if (state.inspector.reportMode) {
      summary.textContent = state.inspector.manualPick
        ? "Click directly on the missed ad. Nothing is sent automatically."
        : "Report selected. Use Copy report again if your clipboard missed it.";
      details.textContent = state.inspector.selectedInfo
        ? "Report copied locally. Paste it into feedback or an issue when you send it."
        : "Click the missed ad on the page. The report includes page URL, element size, source, and safety reason.";
    } else {
      summary.textContent = state.inspector.manualPick
        ? "Manual pick is on. Hover a missed area, then click to select it."
        : `${state.inspector.candidates.length} suspects highlighted. Normal replacement is still conservative.`;
      details.textContent = state.inspector.selectedInfo
        ? formatElementReport(state.inspector.selectedInfo, "Selected element")
        : "Click a dark inspector label, or use Manual pick for anything not highlighted.";
    }

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

  async function saveAndCopyInspectorReport(options = {}) {
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
      status.textContent = options.auto
        ? `Report copied (${savedCount}).`
        : `Saved + copied (${savedCount}).`;
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
      url: formatReportUrl(location.href),
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
      `Page: ${formatReportUrl(location.href)}`,
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
      `Page: ${formatReportUrl(location.href)}`,
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

  async function runScan({ force, contextNodes = [document] }) {
    if (!state.settingsReady) {
      return 0;
    }

    if (!state.settings) {
      state.settings = await loadSettings();
    }

    if (!isDomReplacementAllowed(state.settings) || state.isScanning) {
      return 0;
    }

    state.isScanning = true;
    let inserted = 0;

    try {
      const candidates = collectCandidates(
        expandScanContexts(force ? [document] : contextNodes)
      );
      state.lastScanCandidateCount = candidates.length;

      for (const candidate of candidates) {
        if (!force && inserted >= 6) {
          break;
        }

        if (replaceCandidate(candidate)) {
          inserted += 1;
          state.inserted += 1;
        }
      }

      if (inserted === 0 && candidates.length === 0) {
        state.zeroScanStreak += 1;
      } else {
        state.zeroScanStreak = 0;
      }
    } finally {
      state.isScanning = false;
      if (state.pendingScanNodes && state.pendingScanNodes.size > 0) {
        scheduleScan(80);
      }
    }

    return inserted;
  }

  function collectCandidates(contextNodes = [document]) {
    state.cosmeticMatches = new WeakMap();
    const rawNodes = [];

    for (const context of contextNodes) {
      if (!context) continue;
      if (context instanceof HTMLElement && context.matches(SCAN_SELECTOR)) {
        rawNodes.push(context);
      }
      if (context.querySelectorAll) {
        rawNodes.push(...Array.from(context.querySelectorAll(SCAN_SELECTOR)));
      }
    }

    const nodes = [
      ...rawNodes,
      ...collectCosmeticCandidateNodes(contextNodes)
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

  function collectCosmeticCandidateNodes(contextNodes = [document]) {
    const nodes = [];
    const seen = new Set();
    const maxMatches = 260;
    const priorityMatchesPerRule = 20;

    const addCosmeticNode = (element, rule) => {
      if (!(element instanceof HTMLElement) || seen.has(element)) {
        return false;
      }

      state.cosmeticMatches.set(element, rule);
      nodes.push(element);
      seen.add(element);
      return nodes.length >= maxMatches;
    };

    for (const rule of state.cosmeticRules) {
      if (!rule.domains || rule.domains.length === 0) {
        continue;
      }

      for (const context of contextNodes) {
        if (!context) continue;

        try {
          if (
            context instanceof HTMLElement &&
            context.matches(rule.selector) &&
            addCosmeticNode(context, rule)
          ) {
            return nodes;
          }

          if (context.querySelectorAll) {
            const ruleMatches = Array.from(context.querySelectorAll(rule.selector));
            for (const element of ruleMatches.slice(0, priorityMatchesPerRule)) {
              if (addCosmeticNode(element, rule)) {
                return nodes;
              }
            }
          }
        } catch (_error) {}
      }
    }

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
        for (const context of contextNodes) {
          if (!context) continue;
          try {
            if (context instanceof HTMLElement && context.matches(chunk.selectorString)) {
              if (!matches.includes(context)) matches.push(context);
            }
            if (context.querySelectorAll) {
              const found = Array.from(context.querySelectorAll(chunk.selectorString));
              for (const el of found) {
                if (!matches.includes(el)) matches.push(el);
              }
            }
          } catch (_error) {}
        }
      } else {
        for (const rule of chunk) {
          for (const context of contextNodes) {
            if (!context) continue;
            try {
              if (context instanceof HTMLElement && context.matches(rule.selector)) {
                if (!matches.includes(context)) matches.push(context);
              }
              if (context.querySelectorAll) {
                const ruleMatches = Array.from(context.querySelectorAll(rule.selector));
                for (const el of ruleMatches) {
                  if (!matches.includes(el)) matches.push(el);
                }
              }
            } catch (e) {}
          }
        }
      }

      for (const element of matches.slice(0, 60)) {
        const matchingRule = chunk.find(r => {
          try { return element.matches(r.selector); } catch(e) { return false; }
        });

        if (matchingRule && addCosmeticNode(element, matchingRule)) {
          return nodes;
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

    // The collapsed wrapper is too short to be replaced on its own, and promoting
    // it the usual way fails too: the box holding the gap open carries none of the
    // ad's identifiers when the creative left no caption behind.
    if (isBlockedAdResidue(node)) {
      const gap = findReservedAdGap(node);
      if (gap) {
        return gap;
      }
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
    const sources = getSourceValues(element).join(" ");

    return Boolean(
      brandingTakeover ||
        AD_IDENTIFIER_RE.test(identifiers) ||
        VIDEO_AD_IDENTIFIER_RE.test(identifiers) ||
        hasAdLabel(element) ||
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
      return FULL_PAGE_TAKEOVER_REASON;
    }

    const cosmeticMatch = getCosmeticMatch(element);
    if (cosmeticMatch) {
      return `cosmetic filter: ${cosmeticMatch.selector}`;
    }

    const identifiers = getIdentifierText(element);
    const rect = element.getBoundingClientRect();
    const hasAdIdentifier = AD_IDENTIFIER_RE.test(identifiers);
    const hasBannerIdentifier = BANNER_IDENTIFIER_RE.test(identifiers);
    const hasLabel = hasAdLabel(element);
    const hasAdSource = hasAdLikeSource(element);
    const hasScriptIframe = hasScriptAdIframe(element);
    const hasCommonSize = isCommonAdSize(rect);

    if (
      hasAdIdentifier &&
      !isContentImage(element, rect) &&
      !isProseBlock(element)
    ) {
      return "ad-like identifier";
    }

    if (hasLabel && (isSmallContainer(rect) || isSidebarElement(element))) {
      return "sponsored label";
    }

    if (hasBannerIdentifier && hasCommonSize && !isLikelyHeroBanner(element)) {
      return "banner-sized slot";
    }

    if (
      hasCommonSize &&
      (hasAdSource ||
        hasLabel ||
        (isBareLinkedMediaSlot(element) && isSidebarElement(element)))
    ) {
      return "common ad-sized slot";
    }

    if (
      hasAdSource &&
      (hasLabel || isFixedOrSticky(element) || isSmallContainer(rect)) &&
      !hasNonAdIframe(element)
    ) {
      return "ad-like source";
    }

    if (hasScriptIframe && isSmallContainer(rect)) {
      return "script iframe slot";
    }

    // Last because it is the only branch that walks descendants. Everything a
    // cheaper test can claim has been claimed by now.
    if (isReservedAdGap(element)) {
      return "reserved ad gap";
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

    if (element.shadowRoot) {
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

    if (closestAcrossRoots(element, "a[href]") && !hasAdLikeSource(element)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (!isVisibleRect(rect) && !isViewportEdgeAdOverlay(element, rect)) {
      return false;
    }

    if (isNarrowContentRail(element, rect)) {
      return false;
    }

    if (
      isTooLargeForMvp(rect) &&
      !isBrandingTakeover(element) &&
      !canReplaceExplicitLargeAd(element, rect) &&
      !canCollapseOversizedDomainCosmetic(element, rect) &&
      !isReservedAdGap(element)
    ) {
      return false;
    }

    return true;
  }

  function hasStrongAdSignal(element) {
    const identifiers = getIdentifierText(element);
    const rect = element.getBoundingClientRect();

    return Boolean(
      isBrandingTakeover(element) ||
        hasCosmeticMatch(element) ||
        AD_IDENTIFIER_RE.test(identifiers) ||
        VIDEO_AD_IDENTIFIER_RE.test(identifiers) ||
        hasAdLabel(element) ||
        hasAdLikeSource(element) ||
        hasScriptAdIframe(element) ||
        (isCommonAdSize(rect) &&
          (AD_SOURCE_RE.test(getSourceValues(element).join(" ")) ||
            AD_IDENTIFIER_RE.test(identifiers)))
    );
  }

  function isExplicitAdSlot(element) {
    const identifiers = getIdentifierText(element);
    const sourceText = getSourceValues(element).join(" ");
    const rect = element.getBoundingClientRect();

    if (isBrandingTakeover(element)) {
      return true;
    }

    if (hasExplicitAdDataAttribute(element)) {
      return true;
    }

    if (AD_SOURCE_RE.test(sourceText)) {
      return true;
    }

    if (hasScriptAdIframe(element)) {
      return true;
    }

    if (hasAdLabel(element) && element.matches("iframe,ins,amp-ad")) {
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
        (hasAdLabel(element) ||
          isCommonAdSize(rect) ||
          element.matches("iframe,ins,amp-ad"))
    );
  }

  function isFixedOrSticky(element) {
    const style = window.getComputedStyle(element);
    return style.position === "fixed" || style.position === "sticky";
  }

  // Overlay ads size themselves off the viewport width, so a bar that is 45px tall
  // on a full-screen window is 38px on a half-screen one and drops under the
  // height floor. It is no less in the way. The floor stays where it is for
  // everything else; the escape is narrow on purpose, since nothing editorial is
  // pinned across the whole viewport with a creative loaded from an ad host.
  function isViewportEdgeAdOverlay(element, rect) {
    return Boolean(
      rect.height > 0 &&
        rect.height < AD_OVERLAY_MIN_HEIGHT &&
        rect.width >= window.innerWidth * 0.9 &&
        isFixedOrSticky(element) &&
        hasAdLikeSource(element)
    );
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

  // Our own network layer blocks the creative before it paints, so the site's ad
  // wrapper collapses to whatever markup surrounded it — a caption, or nothing at
  // all. What is left is under the 40px floor that makes an element visible to the
  // scanner, so the wrapper is never claimed, while the module above it still
  // holds the height the creative was going to fill. The blocker's success is what
  // hides the slot, and the reader is left looking at the gap.
  function isBlockedAdResidue(element) {
    if (!(element instanceof HTMLElement) || isExtensionElement(element)) {
      return false;
    }

    if (!hasOwnAdIdentifier(element)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (
      rect.width < AD_RESIDUE_MIN_WIDTH ||
      rect.height <= 0 ||
      rect.height >= AD_RESIDUE_MAX_HEIGHT
    ) {
      return false;
    }

    if (element.querySelector(AD_RESIDUE_CONTENT_SELECTOR)) {
      return false;
    }

    return holdsNothingButResidue(element);
  }

  // The gap is only ours to claim while there is nothing in it but the collapsed
  // wrapper. This is the guard that keeps page-level containers out: a site-content
  // div or a body element wrapping the whole article also contains the residue, and
  // replacing either would take the page with it.
  function holdsNothingButResidue(element) {
    if (element.querySelector(AD_RESIDUE_CONTENT_SELECTOR)) {
      return false;
    }

    const text = String(element.textContent || "").replace(/\s+/g, " ").trim();
    return text === "" || isAdLabelString(text);
  }

  // Walk up from the collapsed wrapper to the box that is actually holding the
  // space open, and stop the moment an ancestor has anything else in it.
  function findReservedAdGap(residue) {
    let current = residue.parentElement;
    let best = null;
    let depth = 0;

    while (current && depth < AD_RESIDUE_MAX_DEPTH) {
      if (
        !(current instanceof HTMLElement) ||
        isExtensionElement(current) ||
        current.matches(AD_RESIDUE_STOP_SELECTOR) ||
        !holdsNothingButResidue(current)
      ) {
        break;
      }

      const rect = current.getBoundingClientRect();
      if (rect.height >= AD_RESIDUE_MAX_HEIGHT && isVisibleRect(rect)) {
        best = current;
      }

      current = current.parentElement;
      depth += 1;
    }

    return best;
  }

  function isReservedAdGap(element) {
    if (
      !(element instanceof HTMLElement) ||
      isExtensionElement(element) ||
      element.matches(AD_RESIDUE_STOP_SELECTOR)
    ) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.height < AD_RESIDUE_MAX_HEIGHT || !isVisibleRect(rect)) {
      return false;
    }

    if (!holdsNothingButResidue(element)) {
      return false;
    }

    return Array.from(element.querySelectorAll(AD_RESIDUE_WRAPPER_SELECTOR)).some(
      isBlockedAdResidue
    );
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

    if (hasAdLabel(element)) {
      score += 3;
      reasons.push("ad/sponsor label");
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

    if (element.shadowRoot) {
      blocks.push("open shadow host");
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

    if (closestAcrossRoots(element, "a[href]") && !hasAdLikeSource(element)) {
      blocks.push("inside normal link");
    }

    const rect = element.getBoundingClientRect();
    if (!isVisibleRect(rect) && !isViewportEdgeAdOverlay(element, rect)) {
      blocks.push("not visibly sized");
    }

    if (isNarrowContentRail(element, rect)) {
      blocks.push("mixed narrow content rail");
    }

    if (
      isTooLargeForMvp(rect) &&
      !canReplaceExplicitLargeAd(element, rect) &&
      !canCollapseOversizedDomainCosmetic(element, rect) &&
      !isReservedAdGap(element)
    ) {
      blocks.push("too large for normal replacement");
    }

    return Array.from(new Set(blocks));
  }

  function isExtensionElement(element) {
    return Boolean(
      closestAcrossRoots(
        element,
        ".attention-redirector-slot,.attention-redirector-card,.attention-redirector-inspector,.attention-redirector-inspector-box,.attention-redirector-manual-hover,.attention-redirector-manual-capture,.attention-redirector-style"
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

  function isDomReplacementAllowed(settings) {
    if (!isPageAllowed(settings)) {
      return false;
    }

    return !isDomainDisabled(location.hostname, DOM_REPLACEMENT_DISABLED_DOMAINS);
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
    const isFixedOverlay = window.getComputedStyle(element).position === "fixed";
    const collapseOversizedCosmetic = canCollapseOversizedDomainCosmetic(element, rect);

    ensureReplacementRootStyles(slot);
    slot.dataset.attentionRedirectorReplaced = "true";
    slot.dataset.attentionRedirectorSurfaceKey = surfaceKey;
    slot.dataset.attentionRedirectorWidth = String(Math.round(rect.width));
    slot.dataset.attentionRedirectorHeight = String(Math.round(rect.height));
    // Capture overlay status before slot classes apply position overrides
    // (--preserve-children forces position: relative on the element).
    if (isFixedOverlay) {
      slot.dataset.attentionRedirectorOverlay = "true";
    }
    if (collapseOversizedCosmetic) {
      slot.dataset.attentionRedirectorCollapse = "oversized-cosmetic";
    }
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

    if (rect.height >= 320 && rect.height > rect.width * 1.8) {
      slot.classList.add("attention-redirector-slot--tall");
    }

    renderReplacementSlot(slot);
    return true;
  }

  function applySettingsToReplacedSlots() {
    queryAllScanRoots(".attention-redirector-slot").forEach((slot) => {
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

    // Overlay ads are hidden, never carded: a Tide card in a fixed overlay or
    // viewport takeover occupies the screen exactly like the ad did. Cards are
    // reserved for in-flow slots, where they preserve the page's layout.
    const isOverlaySlot =
      slot.dataset.attentionRedirectorReason === FULL_PAGE_TAKEOVER_REASON ||
      slot.dataset.attentionRedirectorOverlay === "true" ||
      window.getComputedStyle(slot).position === "fixed";
    const shouldCollapseSlot =
      isOverlaySlot ||
      slot.dataset.attentionRedirectorCollapse === "oversized-cosmetic";

    const pageAllowed = isPageAllowed(state.settings);
    const visualizeSurface = shouldVisualizeSurface(surfaceKey);
    if (!pageAllowed || shouldCollapseSlot || !visualizeSurface) {
      if (existingGuard) {
        existingGuard.disconnect();
        state.replacementGuards.delete(slot);
      }
      slot.dataset.attentionRedirectorPresentation = "clean";
      removeReplacementCards(slot);
      // Collapse the slot out of flow — so the page reflows like an ad blocker —
      // when the user has actively cleaned this surface (Clean, or the hidden
      // share at partial presence) or it is an overlay/oversized cosmetic. When
      // the extension or site is simply turned off we only hide, so a refresh
      // restores the original layout without us having removed boxes first.
      const collapse = shouldCollapseSlot || (pageAllowed && !visualizeSurface);
      hideReplacementSlot(slot, { collapse });
      return;
    }

    slot.style.removeProperty("display");
    slot.style.removeProperty("visibility");
    slot.style.removeProperty("pointer-events");

    // Our own hiding is inline, so it is gone by this line and what remains is the
    // site's. A slot the site keeps hidden has no attention to redirect: carding it
    // puts a note nobody can read into a gap nobody was meant to see, and forcing
    // the card visible would fill a blank the page deliberately left blank.
    if (window.getComputedStyle(slot).visibility === "hidden") {
      removeReplacementCards(slot);
      return;
    }

    slot.dataset.attentionRedirectorPresentation = "ambient";
    const card = buildCard(createCardModel(surfaceKey), rect);
    removeReplacementCards(slot);
    if (preservesSiteChildren) {
      slot.append(card);
    } else {
      slot.replaceChildren(card);
    }
    fitCardText(card);
    observeCardMotion(card);
    installReplacementGuard(slot, card);
  }

  function hideReplacementSlot(slot, { collapse = false } = {}) {
    if (collapse) {
      slot.style.setProperty("display", "none", "important");
      slot.style.setProperty("min-height", "0", "important");
      slot.style.setProperty("height", "0", "important");
      slot.style.setProperty("padding", "0", "important");
      slot.style.setProperty("margin", "0", "important");
      slot.style.setProperty("border", "0", "important");
      slot.style.setProperty("pointer-events", "none", "important");
      return;
    }

    slot.style.removeProperty("display");
    slot.style.setProperty("visibility", "hidden", "important");
    slot.style.setProperty("pointer-events", "none", "important");
  }

  function ensureReplacementRootStyles(slot) {
    const root = getContainingOpenShadowRoot(slot);
    if (root) {
      ensureShadowRootStyles(root);
    }
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

    const w = rect.width || 0;
    const h = rect.height || 0;
    if (w && h) {
      const pad = Math.round(Math.min(Math.max(Math.min(w, h) * 0.1, 10), 48));
      card.style.setProperty("--ar-card-pad", `${pad}px`);
      card.style.setProperty("--ar-card-font", `${cardFontCeiling(rect)}px`);
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

  // Below this the note is technically present and practically unreadable, so the
  // card stops shrinking and clamps instead. An honest ellipsis beats microscopic
  // text that only looks like it fits.
  const CARD_FONT_FLOOR = 13;

  // The size a card would like to use if the note were short, by slot shape. The
  // fit pass only ever comes down from here, so a short note in a big slot still
  // renders at the size it always did.
  function cardFontCeiling(rect) {
    const w = rect.width || 0;
    const h = rect.height || 0;

    if (!(w && h)) {
      return 44;
    }
    if (h >= 320 && h > w * 1.8) {
      return Math.round(Math.min(Math.max(w * 0.13, 18), 30));
    }
    if (w < 420) {
      return 20;
    }
    if (h < 90) {
      return 15;
    }
    if (w < 260 || h < 110) {
      return 17;
    }
    return Math.round(Math.min(Math.max(h * 0.22, 18), 44));
  }

  // Sizing text from the slot's height alone cannot know how much text there is,
  // so a long note was silently clamped away — the card looked fine and the
  // sentence was missing its ending. Measure the rendered note against the box it
  // has to live in and step the size down until it fits, then set the line count
  // from what actually fits so a note that hits the floor ends in an ellipsis
  // rather than a shaved half-line.
  function fitCardText(card) {
    const body = card.querySelector(".attention-redirector-card__body");
    if (!body) {
      return;
    }

    const style = window.getComputedStyle(card);
    const availableWidth =
      card.clientWidth -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight);
    const availableHeight =
      card.clientHeight -
      parseFloat(style.paddingTop) -
      parseFloat(style.paddingBottom);
    if (!(availableWidth > 0 && availableHeight > 0)) {
      return;
    }

    // Unclamp while measuring, or the body reports the size the clamp already cut
    // it to instead of the size the note wants.
    card.style.setProperty("--ar-card-lines", "999");

    const ceiling = Math.round(
      parseFloat(card.style.getPropertyValue("--ar-card-font")) || 44
    );
    const floor = Math.min(CARD_FONT_FLOOR, ceiling);

    // The note has to fit in whole lines, because whole lines are what the clamp
    // will keep. Measuring against the raw box height instead lets a size through
    // whose last line the clamp then cuts.
    const measure = (size) => {
      card.style.setProperty("--ar-card-font", `${size}px`);
      const lineHeight =
        parseFloat(window.getComputedStyle(body).lineHeight) || size * 1.08;
      const lines = Math.max(1, Math.floor(availableHeight / lineHeight));
      return {
        lines,
        fits:
          body.scrollHeight <= lines * lineHeight + 1 &&
          body.scrollWidth <= availableWidth + 1
      };
    };

    let best = null;
    let bestLines = 1;
    const atCeiling = measure(ceiling);

    if (atCeiling.fits) {
      best = ceiling;
      bestLines = atCeiling.lines;
    } else {
      let low = floor;
      let high = ceiling - 1;
      // Six halvings resolve the whole range to the nearest pixel.
      for (let step = 0; step < 6 && low <= high; step += 1) {
        const middle = Math.floor((low + high) / 2);
        const result = measure(middle);
        if (result.fits) {
          best = middle;
          bestLines = result.lines;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
    }

    if (best === null) {
      // Longer than the slot can hold at a readable size. Render at the floor and
      // let the clamp end it with an ellipsis.
      best = floor;
      bestLines = measure(floor).lines;
    }

    card.style.setProperty("--ar-card-font", `${best}px`);
    card.style.setProperty("--ar-card-lines", String(bestLines));
  }

  function createCardModel(surfaceKey) {
    const sequence = state.cardSequence;
    state.cardSequence += 1;

    return {
      mode: state.settings.mode,
      body: selectAnchorNote(surfaceKey),
      motionDelay: -(((hashString(surfaceKey) + sequence) % 6) * 5)
    };
  }

  function selectAnchorNote(surfaceKey) {
    const notes = normalizeAnchorNotes(
      state.settings.anchorNotes,
      state.settings.anchorNote
    );
    return notes[hashString(surfaceKey) % notes.length];
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
      element.getAttribute("data-testid"),
      element.getAttribute("data-ad-slot"),
      element.getAttribute("data-ad-client"),
      element.localName
    ];

    return parts.filter(Boolean).join(" ").toLowerCase();
  }

  // aria-label is human prose, not a machine identifier: an app describing ads
  // (e.g. "Ads conversion diagnostic") must never be condemned by it, but it may
  // still veto a replacement as unsafe.
  function getSafetyIdentifierText(element) {
    const ariaLabel = element.getAttribute("aria-label");
    return ariaLabel
      ? `${getIdentifierText(element)} ${ariaLabel.toLowerCase()}`
      : getIdentifierText(element);
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

  function getOwnText(element) {
    return Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join(" ");
  }

  function isAdLabelString(value) {
    if (!value) {
      return false;
    }

    const text = String(value).replace(/\s+/g, " ").trim();
    if (!text || text.length > AD_LABEL_MAX_LENGTH) {
      return false;
    }

    return AD_LABEL_RE.test(text);
  }

  function hasAdLabel(element) {
    if (
      isAdLabelString(getOwnText(element)) ||
      isAdLabelString(element.getAttribute("aria-label")) ||
      isAdLabelString(element.getAttribute("title"))
    ) {
      return true;
    }

    // A label-only leaf counts only when the container has little other text.
    // Long text blocks that happen to contain a standalone "Реклама"/"Sponsored"
    // word (icon legends, encyclopedia definitions) are editorial content.
    const totalText = String(element.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    if (totalText.length > 120) {
      return false;
    }

    // A container holding nothing but the caption is self-identifying, whatever
    // element the caption sits in. Without this the leaf scan below decides, and
    // it cannot see a caption written as <p>Advertisement</p> or as a link, which
    // is how a slot survives with its label still showing. The label pattern is
    // anchored, so this matches only text that is the caption and nothing else.
    if (isAdLabelString(totalText)) {
      return true;
    }

    const descendants = element.querySelectorAll(
      "span,div,p,small,b,strong,em,i,h4,h5,h6,figcaption,label"
    );
    let checked = 0;

    for (const node of descendants) {
      if (checked >= 40) {
        break;
      }
      checked += 1;

      // A leaf inside a link is site chrome ("Advertising" nav links) and a leaf
      // inside a paragraph is prose (the bolded label word in a definition).
      // Neither is a slot badge. The paragraph itself is the exception: a <p>
      // whose own text is the whole caption is how sites mark a slot, and
      // skipping it is what left labelled banners standing with their caption
      // showing above a reserved gap. The 120-character cap above keeps this
      // away from anything with real content around the badge.
      if (node.parentElement && node.parentElement.closest("a,p")) {
        continue;
      }

      if (isAdLabelString(getOwnText(node))) {
        return true;
      }
    }

    return false;
  }

  function isBareLinkedMediaSlot(element) {
    const children = Array.from(element.children).filter(
      (child) => !child.matches("script,style,noscript")
    );
    if (children.length !== 1 || !children[0].matches("a[href]")) {
      return false;
    }

    const link = children[0];
    if (link.textContent.trim()) {
      return false;
    }

    const media = link.querySelector("img,embed,picture,iframe");
    if (!media) {
      return false;
    }

    return hasSimilarRect(media, element);
  }

  function hasNonAdIframe(element) {
    return Array.from(element.querySelectorAll("iframe"))
      .slice(0, 8)
      .some((frame) => {
        const src =
          frame.getAttribute("src") || frame.getAttribute("data-src") || "";
        if (!src || /^(about:|javascript:)/i.test(src)) {
          return false;
        }
        return !AD_SOURCE_RE.test(src);
      });
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

  function hasAdScriptEvidence(element) {
    return AD_SCRIPT_TEXT_RE.test(getAdScriptText(element));
  }

  function hasBoundedAdScriptEvidence(element) {
    if (!hasAdScriptEvidence(element)) {
      return false;
    }

    return isBoundedAdContainerRect(element.getBoundingClientRect());
  }

  function getAdScriptText(element) {
    const scripts = element.matches("script")
      ? [element]
      : Array.from(element.querySelectorAll("script")).slice(0, 4);

    return scripts
      .map((script) => script.textContent || "")
      .join(" ")
      .slice(0, 2200);
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

  function hasExplicitAdDataAttribute(element) {
    return String(element.getAttribute("data-ad") || "").toLowerCase() === "true";
  }

  function truncateMiddle(value, maxLength) {
    if (value.length <= maxLength) {
      return value;
    }

    const half = Math.floor((maxLength - 3) / 2);
    return `${value.slice(0, half)}...${value.slice(-half)}`;
  }

  function hasUnsafeIdentifier(element) {
    return UNSAFE_IDENTIFIER_RE.test(getSafetyIdentifierText(element));
  }

  function hasHardUnsafeIdentifier(element) {
    return HARD_UNSAFE_IDENTIFIER_RE.test(getSafetyIdentifierText(element));
  }

  function hasSoftUnsafeIdentifier(element) {
    return SOFT_UNSAFE_IDENTIFIER_RE.test(getSafetyIdentifierText(element));
  }

  function hasUnsafeIdentifierInAncestors(element) {
    let current = element.parentElement;

    while (current && current !== document.body) {
      if (UNSAFE_IDENTIFIER_RE.test(getSafetyIdentifierText(current))) {
        return true;
      }

      current = current.parentElement;
    }

    return false;
  }

  function hasHardUnsafeIdentifierInAncestors(element) {
    let current = element.parentElement;

    while (current && current !== document.body) {
      if (HARD_UNSAFE_IDENTIFIER_RE.test(getSafetyIdentifierText(current))) {
        return true;
      }

      current = current.parentElement;
    }

    return false;
  }

  function hasSoftUnsafeIdentifierInAncestors(element) {
    let current = element.parentElement;

    while (current && current !== document.body) {
      if (SOFT_UNSAFE_IDENTIFIER_RE.test(getSafetyIdentifierText(current))) {
        return true;
      }

      current = current.parentElement;
    }

    return false;
  }

  function hasHardUnsafeAncestor(element) {
    return Boolean(closestAcrossRoots(element, HARD_UNSAFE_ANCESTOR_SELECTOR));
  }

  function hasSoftUnsafeAncestor(element) {
    return Boolean(closestAcrossRoots(element, SOFT_UNSAFE_ANCESTOR_SELECTOR));
  }

  function isVisibleRect(rect) {
    return rect.width >= VISIBLE_MIN_WIDTH && rect.height >= VISIBLE_MIN_HEIGHT;
  }

  function isSmallContainer(rect) {
    return rect.width <= 420 || rect.height <= 320;
  }

  function isBoundedAdContainerRect(rect) {
    return (
      isVisibleRect(rect) &&
      rect.width <= 1100 &&
      rect.height <= 340 &&
      rect.width * rect.height <= 260000
    );
  }

  function isNarrowContentRail(element, rect) {
    if (rect.width > 360 || rect.height <= 760) {
      return false;
    }

    const text = String(element.innerText || element.textContent || "")
      .replace(/\s+/g, " ")
      .trim();

    return (
      text.length > 180 &&
      element.children.length > 3 &&
      !hasOwnAdIdentifier(element) &&
      !isBrandingTakeover(element)
    );
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

  function canCollapseOversizedDomainCosmetic(element, rect) {
    const cosmeticMatch =
      typeof getCosmeticMatch === "function" ? getCosmeticMatch(element) : null;
    if (!cosmeticMatch || !cosmeticMatch.domains || cosmeticMatch.domains.length === 0) {
      return false;
    }

    if (!isTooLargeForMvp(rect)) {
      return false;
    }

    if (element.matches("html,body,main,article,header,footer,form")) {
      return false;
    }

    return (
      rect.width <= window.innerWidth * 1.05 &&
      rect.height <= Math.max(1200, window.innerHeight * 1.35)
    );
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

  // A picture the site sized for itself is content. Display creatives arrive at
  // the standard sizes or from an ad host, so a bare image whose only ad signal
  // is a class token is a photograph — TechRadar writes its article heroes as
  // class="block-image-ads hero-image". An ad-identified container around such an
  // image is still a candidate on its own, so nothing real is lost here.
  function isContentImage(element, rect) {
    return (
      element.matches("img,picture") &&
      !isCommonAdSize(rect) &&
      !hasAdLikeSource(element)
    );
  }

  // A citation, caption, or table cell naming an advertising publication carries
  // an ad token in its identifier and nothing else that says "slot". It stays
  // under the height floor at desktop widths, so nothing caught it until the page
  // narrowed and the sentence wrapped onto a third line.
  //
  // Real slots live in these tags too — commerce tiles in a carousel are `li` with
  // prose-length text — and the thing that separates them is structure, not media:
  // a tile is a built layout of ten to fourteen elements, while a sentence holds a
  // link at most. Media is the wrong test because tiles lazy-load their images,
  // so at scan time they look as empty as prose does.
  function isProseBlock(element) {
    if (
      !element.matches(PROSE_FLOW_SELECTOR) ||
      element.querySelectorAll("*").length > PROSE_MAX_ELEMENTS ||
      element.querySelector(AD_MEDIA_SELECTOR) ||
      hasAdLikeSource(element)
    ) {
      return false;
    }

    const text = String(element.textContent || "").replace(/\s+/g, " ").trim();
    return text.length > AD_LABEL_MAX_LENGTH && !MARKUP_AS_TEXT_RE.test(text);
  }

  function isSidebarElement(element) {
    return Boolean(
      closestAcrossRoots(element, "aside,[role='complementary']") ||
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

  function findLinkedMediaAdContainer(element) {
    if (!isLinkedCommonMediaAd(element)) {
      return null;
    }

    const link = closestAcrossRoots(element, "a[href]");
    if (!link) {
      return null;
    }

    let current = link.parentElement;
    let depth = 0;

    while (current && current !== document.body && depth < 3) {
      if (
        current instanceof HTMLElement &&
        !current.matches("main,article,nav,header,footer,form") &&
        containsOnlyLinkedMediaAd(current, link, element) &&
        hasSimilarRect(element, current) &&
        safeToReplace(current)
      ) {
        return current;
      }

      current = current.parentElement;
      depth += 1;
    }

    return null;
  }

  function isLinkedCommonMediaAd(element) {
    if (!(element instanceof HTMLElement) || !element.matches("img,embed")) {
      return false;
    }

    if (!closestAcrossRoots(element, "a[href]") || !isSidebarElement(element)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return isVisibleRect(rect) && isCommonAdSize(rect) && !isLikelyHeroBanner(element);
  }

  function containsOnlyLinkedMediaAd(container, link, media) {
    if (container.querySelector("form,input,textarea,select,[contenteditable='true']")) {
      return false;
    }

    const children = Array.from(container.children).filter((child) => {
      return !child.matches("script,style,noscript");
    });
    if (children.length !== 1 || children[0] !== link) {
      return false;
    }

    if (!link.contains(media) || link.textContent.trim()) {
      return false;
    }

    const linkedMedia = Array.from(
      link.querySelectorAll("img,embed,iframe,picture")
    );
    return linkedMedia.length >= 1 && linkedMedia.length <= 2;
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
