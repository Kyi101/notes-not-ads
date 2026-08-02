import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PROTOCOLS, TIERS, classifySitePolicy, domainMatches, normalizeHost } =
  require("../src/site-policy.js");

function assertPolicy(input, expected, label) {
  const actual = classifySitePolicy(input);
  assert.equal(actual.tier, expected.tier, `${label}: tier`);
  assert.equal(actual.protocol, expected.protocol, `${label}: protocol`);
  if (expected.confidence) {
    assert.equal(actual.confidence, expected.confidence, `${label}: confidence`);
  }
  if (expected.blockedEscalations) {
    expected.blockedEscalations.forEach((protocol) => {
      assert.ok(
        actual.blockedEscalations.includes(protocol),
        `${label}: blocks ${protocol}`
      );
    });
  }
  return actual;
}

assert.equal(normalizeHost("HTTPS://Ads.Google.com/aw/campaigns"), "ads.google.com");
assert.equal(domainMatches("sub.example.com", ["example.com"]), true);
assert.equal(domainMatches("badexample.com", ["example.com"]), false);

const googleAds = assertPolicy(
  { url: "https://ads.google.com/aw/campaigns" },
  {
    tier: TIERS.PROTECTED,
    protocol: PROTOCOLS.PROTECTED_STANDARD,
    confidence: "high",
    blockedEscalations: [PROTOCOLS.AD_HEAVY, PROTOCOLS.HOSTILE]
  },
  "Google Ads"
);
assert.ok(
  googleAds.notes.some((note) => /baseline remains active/.test(note)),
  "Google Ads should not be softened preemptively"
);

assertPolicy(
  { url: "https://www.canva.com/design/DAG/example/edit" },
  {
    tier: TIERS.PROTECTED,
    protocol: PROTOCOLS.PROTECTED_STANDARD,
    confidence: "high",
    blockedEscalations: [PROTOCOLS.AD_HEAVY, PROTOCOLS.HOSTILE]
  },
  "Canva editor"
);

assertPolicy(
  { url: "https://www.notion.com/" },
  {
    tier: TIERS.PROTECTED,
    protocol: PROTOCOLS.PROTECTED_STANDARD,
    confidence: "high",
    blockedEscalations: [PROTOCOLS.AD_HEAVY, PROTOCOLS.HOSTILE]
  },
  "Notion current domain"
);

assertPolicy(
  { url: "https://www.ukr.net/", enabled: false },
  {
    tier: TIERS.DISABLED,
    protocol: PROTOCOLS.DISABLED,
    confidence: "high"
  },
  "global disabled wins"
);

assertPolicy(
  {
    url: "https://www.ukr.net/",
    disabledDomains: ["ukr.net"]
  },
  {
    tier: TIERS.DISABLED,
    protocol: PROTOCOLS.DISABLED,
    confidence: "high"
  },
  "current-site disabled wins"
);

assertPolicy(
  { url: "https://www.ukr.net/login" },
  {
    tier: TIERS.SENSITIVE,
    protocol: PROTOCOLS.PROTECTED_STANDARD,
    confidence: "high",
    blockedEscalations: [PROTOCOLS.AD_HEAVY, PROTOCOLS.HOSTILE]
  },
  "sensitive path beats ad-heavy domain"
);

assertPolicy(
  { url: "https://www.ukr.net/" },
  {
    tier: TIERS.AD_HEAVY,
    protocol: PROTOCOLS.AD_HEAVY,
    confidence: "high"
  },
  "known ad-heavy site"
);

assertPolicy(
  {
    url: "https://www.ukr.net/",
    domSignals: { passwordFields: 1 }
  },
  {
    tier: TIERS.AD_HEAVY,
    protocol: PROTOCOLS.AD_HEAVY,
    confidence: "high"
  },
  "single login widget does not soften known ad-heavy portal"
);

assertPolicy(
  {
    url: "https://example.com/",
    domSignals: { passwordFields: 1 }
  },
  {
    tier: TIERS.SENSITIVE,
    protocol: PROTOCOLS.PROTECTED_STANDARD,
    confidence: "medium",
    blockedEscalations: [PROTOCOLS.AD_HEAVY, PROTOCOLS.HOSTILE]
  },
  "password field protects unknown page"
);

assertPolicy(
  { url: "https://www.forbes.com/" },
  {
    tier: TIERS.AD_HEAVY,
    protocol: PROTOCOLS.AD_HEAVY,
    confidence: "high"
  },
  "known ad-heavy publisher"
);

assertPolicy(
  {
    url: "https://example.com/download",
    pageSignals: { takeoverIframes: 1, popupTabs: 2 }
  },
  {
    tier: TIERS.HOSTILE,
    protocol: PROTOCOLS.HOSTILE,
    confidence: "high"
  },
  "hostile evidence"
);

assertPolicy(
  {
    url: "https://ads.google.com/aw/campaigns",
    pageSignals: { takeoverIframes: 1, manyVisibleAds: 8 }
  },
  {
    tier: TIERS.PROTECTED,
    protocol: PROTOCOLS.PROTECTED_STANDARD,
    confidence: "high",
    blockedEscalations: [PROTOCOLS.AD_HEAVY, PROTOCOLS.HOSTILE]
  },
  "protected beats hostile-looking signals"
);

assertPolicy(
  {
    url: "https://example.com/",
    knownBreakage: true
  },
  {
    tier: TIERS.PROTECTED,
    protocol: PROTOCOLS.PROTECTED_SOFT,
    confidence: "high",
    blockedEscalations: [PROTOCOLS.AD_HEAVY, PROTOCOLS.HOSTILE]
  },
  "known breakage softens"
);

assertPolicy(
  { url: "https://example.com/" },
  {
    tier: TIERS.STANDARD,
    protocol: PROTOCOLS.STANDARD,
    confidence: "low"
  },
  "unknown defaults to standard"
);

console.log("site policy tests passed");
