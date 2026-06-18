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



