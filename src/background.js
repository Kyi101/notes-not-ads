const STORAGE_KEY = "attentionRedirectorSettings";
const STATIC_RULESET_IDS = ["ruleset_1", "easylist"];
const DNR_ALLOW_RULE_START_ID = 900000;
const DNR_TAB_ALLOW_RULE_START_ID = 910000;
const DNR_RESOURCE_TYPES = [
  "script",
  "image",
  "xmlhttprequest",
  "sub_frame",
  "ping",
  "media",
  "websocket",
  "other"
];

const SENSITIVE_DNR_DOMAINS = [
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

async function syncTabDnrAllowRule(tabId, allowRequests) {
  if (!Number.isInteger(tabId) || tabId < 0) {
    return;
  }

  const ruleId = DNR_TAB_ALLOW_RULE_START_ID + tabId;
  const removeRuleIds = [ruleId];
  const addRules = allowRequests
    ? [
        {
          id: ruleId,
          priority: 1000,
          action: { type: "allow" },
          condition: {
            tabIds: [tabId],
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
      console.error("Attention Redirector DNR sync failed", error);
    });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[STORAGE_KEY]) {
    return;
  }

  syncNetRequestState(changes[STORAGE_KEY].newValue || {}).catch((error) => {
    console.error("Attention Redirector DNR sync failed", error);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "AR_SYNC_PAGE_DNR_ALLOW") {
    return false;
  }

  syncTabDnrAllowRule(sender.tab && sender.tab.id, message.allow === true)
    .then(() => {
      sendResponse({ ok: true });
    })
    .catch((error) => {
      console.error("Attention Redirector tab DNR sync failed", error);
      sendResponse({ ok: false, error: String(error && error.message || error) });
    });

  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  syncTabDnrAllowRule(tabId, false).catch((error) => {
    console.error("Attention Redirector tab DNR cleanup failed", error);
  });
});

chrome.runtime.onInstalled.addListener((details) => {
  syncFromStorage();
  if (details && details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
  }
});
chrome.runtime.onStartup.addListener(syncFromStorage);
