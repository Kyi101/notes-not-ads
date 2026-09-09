const STORAGE_KEY = "attentionRedirectorSettings";
const STATIC_RULESET_IDS = ["ruleset_1", "easylist"];
const DNR_ALLOW_RULE_START_ID = 900000;
const DNR_TAB_ALLOW_RULE_START_ID = 910000;
// Must cover every resource type the packaged rules can block, or the
// sensitive-page allow is not the zero-footprint promise it is written to be:
// a blocked request whose type is missing here stays blocked on a bank or
// checkout page. `stylesheet` (43 packaged rules) and `object` (1) were absent
// — reported privately 2026-08-31, though only the stylesheet half was noticed.
// scripts/test-dnr-allow-coverage.mjs recomputes the union from the shipped
// rules and fails if this list falls behind again.
const DNR_RESOURCE_TYPES = [
  "script",
  "image",
  "stylesheet",
  "object",
  "xmlhttprequest",
  "sub_frame",
  "ping",
  "media",
  "websocket",
  "other"
];

// Must mirror SENSITIVE_DOMAINS in src/shared.js. The content script also asks
// for a per-tab allow rule, but that arrives at document_end; these are in
// place before the first request.
const SENSITIVE_DNR_DOMAINS = [
  "accounts.google.com",
  "docs.google.com",
  "drive.google.com",
  "mail.google.com",
  "inbox.google.com",
  "calendar.google.com",
  "pay.google.com",
  "payments.google.com",
  "wallet.google.com",
  "passwords.google.com",
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
  "citibank.com",
  "schwab.com",
  "fidelity.com",
  "vanguard.com",
  "etrade.com",
  "interactivebrokers.com",
  "ally.com",
  "wise.com",
  "revolut.com",
  "monzo.com",
  "n26.com",
  "kraken.com",
  "binance.com",
  "1password.com",
  "bitwarden.com",
  "lastpass.com",
  "dashlane.com",
  "keepersecurity.com",
  "authy.com"
];

async function syncNetRequestState(settings = {}) {
  const enabled = settings.enabled !== false;

  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: enabled ? STATIC_RULESET_IDS : [],
    disableRulesetIds: enabled ? [] : STATIC_RULESET_IDS
  });

  if (!enabled) {
    await clearAllDnrAllowRules();
    return;
  }

  await syncDnrAllowRules([...SENSITIVE_DNR_DOMAINS, ...(settings.disabledDomains || [])]);
}

async function syncDnrAllowRules(allowedInitiatorDomains = []) {
  const existingRules = await chrome.declarativeNetRequest.getSessionRules();
  const removeRuleIds = existingRules
    .filter((rule) => {
      return (
        rule.id >= DNR_ALLOW_RULE_START_ID &&
        rule.id < DNR_TAB_ALLOW_RULE_START_ID
      );
    })
    .map((rule) => rule.id);

  const domains = normalizeDomains(allowedInitiatorDomains);

  const addRules = domains.map((domain, index) => {
    return {
      id: DNR_ALLOW_RULE_START_ID + index,
      priority: 1000,
      action: { type: "allow" },
      condition: {
        initiatorDomains: [domain],
        resourceTypes: DNR_RESOURCE_TYPES
      }
    };
  });

  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds,
    addRules
  });
}

async function clearAllDnrAllowRules() {
  const existingRules = await chrome.declarativeNetRequest.getSessionRules();
  const removeRuleIds = existingRules
    .filter((rule) => rule.id >= DNR_ALLOW_RULE_START_ID)
    .map((rule) => rule.id);

  if (!removeRuleIds.length) {
    return;
  }

  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds
  });
}

// `initiatorDomain` is what keeps this rule from outliving its page.
//
// Scoping the allow to the tab alone meant it applied to whatever the tab
// showed next, and removing it on navigation is a race the worker can lose: a
// terminated service worker has to be woken before the listener runs, and the
// parser has already asked for everything in <head> by then. That race is
// exactly what failed in CI while passing locally. Naming the initiator makes
// the rule stop matching the moment the tab is showing a different site,
// whether or not anything got around to tearing it down.
//
// The teardown below is still worth having: it covers a route change within one
// host, which the initiator scope cannot distinguish.
async function syncTabDnrAllowRule(tabId, allowRequests, initiatorDomain = "") {
  if (!Number.isInteger(tabId) || tabId < 0) {
    return;
  }

  const domain = normalizeDomain(initiatorDomain);
  const ruleId = DNR_TAB_ALLOW_RULE_START_ID + tabId;
  const removeRuleIds = [ruleId];
  const addRules =
    allowRequests && domain
      ? [
          {
            id: ruleId,
            priority: 1000,
            action: { type: "allow" },
            condition: {
              tabIds: [tabId],
              initiatorDomains: [domain],
              resourceTypes: DNR_RESOURCE_TYPES
            }
          }
        ]
      : [];

  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds,
    addRules
  });
}

function normalizeDomains(values) {
  const domains = [];
  const seen = new Set();

  values.forEach((value) => {
    const domain = normalizeDomain(value);
    if (!domain || seen.has(domain)) {
      return;
    }
    seen.add(domain);
    domains.push(domain);
  });

  return domains;
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

async function loadSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || {};
}

function syncFromStorage() {
  loadSettings()
    .then(syncNetRequestState)
    .catch((error) => {
      console.error("Notes Not Ads DNR sync failed", error);
    });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[STORAGE_KEY]) {
    return;
  }

  syncNetRequestState(changes[STORAGE_KEY].newValue || {}).catch((error) => {
    console.error("Notes Not Ads DNR sync failed", error);
  });
});

// The issue form, and nothing else. A content script asking the worker to open
// a tab is a capability worth keeping narrow: the report itself never travels
// through this message, only a link, and a link that is not the issue form is
// refused rather than opened.
// Same derivation as src/shared.js, from the one place a repository rename
// already has to touch. Neither file can import the other.
function issueFormBaseUrl() {
  try {
    const homepage = String(
      chrome.runtime.getManifest().homepage_url || ""
    ).replace(/\/+$/, "");
    return homepage ? `${homepage}/issues/new` : "";
  } catch (_error) {
    return "";
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "AR_OPEN_ISSUE") {
    const url = String(message.url || "");
    const base = issueFormBaseUrl();
    if (!base || !url.startsWith(`${base}?`)) {
      sendResponse({ ok: false, error: "refused: not the issue form" });
      return false;
    }

    chrome.tabs.create({ url });
    sendResponse({ ok: true });
    return false;
  }

  if (!message || message.type !== "AR_SYNC_PAGE_DNR_ALLOW") {
    return false;
  }

  // The host comes from the sender rather than the message, so a page cannot
  // ask for an allow scoped to somebody else.
  let senderHost = "";
  try {
    senderHost = new URL(sender.origin || (sender.tab && sender.tab.url) || "").hostname;
  } catch (_error) {
    senderHost = "";
  }

  syncTabDnrAllowRule(sender.tab && sender.tab.id, message.allow === true, senderHost)
    .then(() => {
      sendResponse({ ok: true });
    })
    .catch((error) => {
      console.error("Notes Not Ads tab DNR sync failed", error);
      sendResponse({ ok: false, error: String(error && error.message || error) });
    });

  return true;
});

// The tab allow is a network authorization, and it was outliving the page that
// justified it. It is installed by the content script at `document_end` and was
// removed only when the tab closed, so navigating from a bank to an ordinary
// site in the same tab left every request in that tab unblocked until the new
// page's content script ran — which is after the parser has already requested
// the scripts in <head>. Reported privately 2026-08-31 and reproduced: a
// normally blocked script loaded on an ordinary page purely because the tab had
// previously shown a password field.
//
// Dropping it the moment a navigation starts inverts the failure. The content
// script reinstalls it at `document_end` if the new page is sensitive too, so
// the worst case is a few parser-time requests blocked on a sensitive page
// rather than every request allowed on an ordinary one. Blocking too much on a
// bank is recoverable; blocking nothing on the rest of the web is the bug.
//
// `changeInfo.url` rather than only `status` because a History API route change
// reports a URL without ever reporting "loading", which is the SPA half of the
// same report. No new permission is needed for either field: the manifest
// already holds host permissions for all URLs.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "loading" && !changeInfo.url) {
    return;
  }

  syncTabDnrAllowRule(tabId, false)
    .then(() => {
      // Dropping is the safe half. Asking is the other half: a single-page app
      // moving between two sensitive routes also reports a URL change, and the
      // page is the only thing that can say whether the allow is still owed.
      // A tab with no content script simply does not answer.
      chrome.tabs.sendMessage(tabId, { type: "AR_REEVALUATE_TAB_ALLOW" }, () => {
        void chrome.runtime.lastError;
      });
    })
    .catch((error) => {
      console.error("Notes Not Ads tab allow teardown failed", error);
    });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  syncTabDnrAllowRule(tabId, false).catch((error) => {
    console.error("Notes Not Ads tab DNR cleanup failed", error);
  });
});

chrome.runtime.onInstalled.addListener((details) => {
  syncFromStorage();
  if (details && details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
  }
});
chrome.runtime.onStartup.addListener(syncFromStorage);
