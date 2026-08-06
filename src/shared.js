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
  anchorNote: DEFAULT_ANCHOR_NOTE,
  anchorNotes: [DEFAULT_ANCHOR_NOTE],
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

  return notes.slice(0, MAX_ANCHOR_NOTES);
}

// An empty list is an answer, not an absence: emptying the notes is how the user
// says "just block, draw nothing". So the default note is owed only to an install
// that has never written the key at all, and every later read is taken at its
// word — otherwise deleting your last note silently hands it back.
function resolveAnchorNotes(stored, legacyNotes) {
  const written =
    Array.isArray(stored.anchorNotes) ||
    typeof stored.anchorNote === "string" ||
    legacyNotes.length > 0;
  const notes = normalizeAnchorNotes(
    stored.anchorNotes,
    stored.anchorNote,
    legacyNotes
  );
  return written ? notes : DEFAULT_SETTINGS.anchorNotes.slice();
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

const CARD_FONT_STYLE_ID = "attention-redirector-font";

// Both faces ship. Dropping the extended range would leave a note containing a
// single accented letter rendering that letter in the fallback and the rest in
// Space Grotesk, which looks like a bug rather than a fallback.
const CARD_FONT_FILES = [
  {
    file: "fonts/space-grotesk-latin.woff2",
    range:
      "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD"
  },
  {
    file: "fonts/space-grotesk-latin-ext.woff2",
    range:
      "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF"
  }
];

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
  --ar-surface: #e6ebe3;
  --ar-ink: #20312a;
  --ar-ring: rgba(32, 49, 42, 0.12);
  position: relative !important;
  display: flex !important;
  align-items: center !important;
  justify-content: flex-start !important;
  isolation: isolate !important;
  contain: paint !important;
  width: 100% !important;
  min-height: inherit !important;
  height: 100% !important;
  padding: var(--ar-card-pad, clamp(22px, 6vw, 64px)) !important;
  overflow: hidden !important;
  border: 0 !important;
  border-radius: 12px !important;
  background: var(--ar-surface) !important;
  color: var(--ar-ink) !important;
  font-family: "Space Grotesk", "Helvetica Neue", Arial, sans-serif !important;
  font-weight: 500 !important;
  text-align: left !important;
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
  box-shadow: inset 0 0 0 1px var(--ar-ring) !important;
}
.attention-redirector-card[data-host-tone="dark"] {
  --ar-surface: #1d2521;
  --ar-ink: #dce4dd;
  --ar-ring: rgba(220, 228, 221, 0.10);
}
.attention-redirector-card[data-note-length="short"] {
  justify-content: center !important;
  text-align: center !important;
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
  max-width: min(100%, 30em) !important;
  margin: 0 !important;
  color: var(--ar-ink) !important;
  font: inherit !important;
  font-size: var(--ar-card-font, 20px) !important;
  font-weight: 500 !important;
  line-height: var(--ar-card-lh, 1.2) !important;
  letter-spacing: var(--ar-card-track, 0em) !important;
  /* Display leading is tighter than the font's own line box, so ascenders and
     descenders sit outside it. overflow:hidden clips at this box, so without a
     little room the clamp shaves the top and bottom of the note. How much is
     owed depends on the leading, so fitCardText sets it alongside the size. */
  padding-block: var(--ar-card-ink, 0.06em) !important;
  overflow-wrap: anywhere !important;
  -webkit-box-orient: vertical !important;
  -webkit-line-clamp: var(--ar-card-lines, 3) !important;
  overflow: hidden !important;
}
.attention-redirector-card[data-note-length="short"] .attention-redirector-card__body {
  max-width: 100% !important;
}
.attention-redirector-card--compact {
  padding: 12px 34px 12px 16px !important;
  border-radius: 8px !important;
}
.attention-redirector-slot--short .attention-redirector-card {
  padding: 7px 36px 7px 14px !important;
  border-radius: 8px !important;
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
  cosmeticRules: [],
  domainCosmeticRules: [],
  cosmeticMatches: new WeakMap(),
  replacementGuards: new WeakMap(),
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
