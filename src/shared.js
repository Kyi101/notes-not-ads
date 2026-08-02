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
  font-size: clamp(22px, 3.7vw, 46px) !important;
  font-weight: 500 !important;
  letter-spacing: -0.035em !important;
  line-height: 1.08 !important;
  -webkit-box-orient: vertical !important;
  -webkit-line-clamp: 3 !important;
  overflow: hidden !important;
}
.attention-redirector-card--compact {
  padding: 12px 34px 12px 16px !important;
  border-radius: 10px !important;
}
.attention-redirector-card--compact .attention-redirector-card__body {
  font-size: 17px !important;
  -webkit-line-clamp: 2 !important;
}
.attention-redirector-slot--short .attention-redirector-card {
  padding: 7px 36px 7px 14px !important;
  border-radius: 8px !important;
}
.attention-redirector-slot--short .attention-redirector-card__body {
  font-size: 15px !important;
  -webkit-line-clamp: 1 !important;
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
