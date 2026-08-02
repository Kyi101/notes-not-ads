(function initSitePolicy(root) {
  const TIERS = Object.freeze({
    DISABLED: "disabled",
    PROTECTED: "protected",
    SENSITIVE: "sensitive",
    STANDARD: "standard",
    AD_HEAVY: "ad-heavy",
    HOSTILE: "hostile"
  });

  const PROTOCOLS = Object.freeze({
    DISABLED: "disabled",
    PROTECTED_STANDARD: "protected-standard",
    PROTECTED_SOFT: "protected-soft",
    STANDARD: "standard",
    AD_HEAVY: "ad-heavy",
    HOSTILE: "hostile"
  });

  const PROTECTED_DOMAINS = Object.freeze([
    "ads.google.com",
    "admanager.google.com",
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
  ]);

  const AD_HEAVY_DOMAINS = Object.freeze([
    "ukr.net",
    "censor.net",
    "forbes.com",
    "dailymail.co.uk",
    "dailymail.com",
    "nypost.com",
    "thesun.co.uk",
    "the-sun.com",
    "mirror.co.uk",
    "tmz.com",
    "people.com",
    "weather.com",
    "accuweather.com",
    "fandom.com",
    "game8.co",
    "screenrant.com",
    "cnet.com",
    "techradar.com",
    "tomsguide.com",
    "allrecipes.com",
    "foodnetwork.com",
    "yahoo.com",
    "msn.com",
    "bleacherreport.com",
    "espn.com"
  ]);

  // Intentionally empty: the hostile tier is reached from observed page
  // signals (takeover iframes, popup tabs, redirect traps) rather than a
  // shipped list of named sites.
  const HOSTILE_DOMAINS = Object.freeze([]);

  const SENSITIVE_PATH_RE =
    /\/(checkout|cart|basket|payment|payments|billing|invoice|invoices|pay|order|orders|purchase|subscribe|subscription|login|signin|sign-in|password|account\/security)(\/|$)/i;

  function normalizeHost(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) {
      return "";
    }

    try {
      return new URL(raw).hostname.replace(/\.$/, "");
    } catch (error) {
      return raw
        .replace(/^https?:\/\//, "")
        .replace(/\/.*$/, "")
        .replace(/:\d+$/, "")
        .replace(/\.$/, "");
    }
  }

  function getUrlParts(input = {}) {
    try {
      const parsed = new URL(String(input.url || ""));
      return {
        host: parsed.hostname,
        path: parsed.pathname
      };
    } catch (error) {
      return {
        host: "",
        path: ""
      };
    }
  }

  function domainMatches(host, domains) {
    const normalizedHost = normalizeHost(host);
    if (!normalizedHost) {
      return false;
    }

    return normalizeDomainList(domains).some((domain) => {
      return normalizedHost === domain || normalizedHost.endsWith(`.${domain}`);
    });
  }

  function normalizeDomainList(domains) {
    return Array.from(new Set((domains || []).map(normalizeHost).filter(Boolean)));
  }

  function hasPositiveSignal(signals, names) {
    return names.some((name) => {
      const value = signals ? signals[name] : undefined;
      return value === true || (typeof value === "number" && value > 0);
    });
  }

  function evidence(state, signal, value, effect) {
    return { state, signal, value, effect };
  }

  function buildResult(fields) {
    return {
      tier: fields.tier,
      protocol: fields.protocol,
      confidence: fields.confidence || "medium",
      evidence: fields.evidence || [],
      blockedEscalations: fields.blockedEscalations || [],
      notes: fields.notes || []
    };
  }

  function classifySitePolicy(input = {}) {
    const settings = input.settings || {};
    const urlParts = getUrlParts(input);
    const host = normalizeHost(input.host || urlParts.host);
    const path = String(input.path || urlParts.path || "");
    const enabled = input.enabled !== undefined ? input.enabled : settings.enabled;
    const disabledDomains = input.disabledDomains || settings.disabledDomains || [];
    const knownBreakageDomains = input.knownBreakageDomains || [];
    const domSignals = input.domSignals || {};
    const pageSignals = input.pageSignals || {};
    const resultEvidence = [];

    if (enabled === false) {
      resultEvidence.push(evidence("given", "enabled", false, "disable all blocking"));
      return buildResult({
        tier: TIERS.DISABLED,
        protocol: PROTOCOLS.DISABLED,
        confidence: "high",
        evidence: resultEvidence
      });
    }

    if (domainMatches(host, disabledDomains)) {
      resultEvidence.push(
        evidence("given", "disabledDomains", host, "disable current site")
      );
      return buildResult({
        tier: TIERS.DISABLED,
        protocol: PROTOCOLS.DISABLED,
        confidence: "high",
        evidence: resultEvidence
      });
    }

    const knownBreakage =
      input.knownBreakage === true || domainMatches(host, knownBreakageDomains);
    const protectedDomain = domainMatches(host, PROTECTED_DOMAINS);
    const knownAdHeavyDomain = domainMatches(host, AD_HEAVY_DOMAINS);
    const sensitivePath = SENSITIVE_PATH_RE.test(path);
    const highCostSensitiveDom = hasPositiveSignal(domSignals, [
      "paymentForms",
      "contentEditors",
      "accountForms",
      "checkoutForms",
      "appShell"
    ]);
    const passwordFields = Number(domSignals.passwordFields || 0);
    const passwordSensitive = passwordFields > 0 && !knownAdHeavyDomain;
    const sensitiveDom = highCostSensitiveDom || passwordSensitive;

    if (protectedDomain) {
      resultEvidence.push(
        evidence("derived", "protectedDomain", host, "protect from escalation")
      );

      if (knownBreakage) {
        resultEvidence.push(
          evidence("observed", "knownBreakage", true, "soften protected page")
        );
      }

      return buildResult({
        tier: TIERS.PROTECTED,
        protocol: knownBreakage
          ? PROTOCOLS.PROTECTED_SOFT
          : PROTOCOLS.PROTECTED_STANDARD,
        confidence: "high",
        evidence: resultEvidence,
        blockedEscalations: [PROTOCOLS.AD_HEAVY, PROTOCOLS.HOSTILE],
        notes: knownBreakage
          ? ["use protected-soft only because breakage was proven"]
          : ["baseline remains active unless breakage is proven"]
      });
    }

    if (sensitivePath || sensitiveDom || knownBreakage) {
      if (sensitivePath) {
        resultEvidence.push(
          evidence("observed", "sensitivePath", path, "protect workflow")
        );
      }
      if (sensitiveDom) {
        resultEvidence.push(
          evidence("observed", "sensitiveDom", true, "protect app UI")
        );
      }
      if (knownBreakage) {
        resultEvidence.push(
          evidence("observed", "knownBreakage", true, "soften broken page")
        );
      }

      return buildResult({
        tier: sensitivePath || sensitiveDom ? TIERS.SENSITIVE : TIERS.PROTECTED,
        protocol: knownBreakage
          ? PROTOCOLS.PROTECTED_SOFT
          : PROTOCOLS.PROTECTED_STANDARD,
        confidence: sensitivePath || knownBreakage ? "high" : "medium",
        evidence: resultEvidence,
        blockedEscalations: [PROTOCOLS.AD_HEAVY, PROTOCOLS.HOSTILE]
      });
    }

    const knownHostileDomain = domainMatches(host, HOSTILE_DOMAINS);
    const hostileEvidence = hasPositiveSignal(pageSignals, [
      "popupTabs",
      "takeoverIframes",
      "redirectTraps",
      "fakeDownloadButtons"
    ]);

    if (knownHostileDomain || hostileEvidence) {
      resultEvidence.push(
        evidence(
          knownHostileDomain ? "derived" : "observed",
          knownHostileDomain ? "hostileDomain" : "hostileSignals",
          knownHostileDomain ? host : true,
          "allow hostile cleanup"
        )
      );
      return buildResult({
        tier: TIERS.HOSTILE,
        protocol: PROTOCOLS.HOSTILE,
        confidence: knownHostileDomain ? "medium" : "high",
        evidence: resultEvidence
      });
    }

    const highAdPressure =
      pageSignals.adPressure === "high" ||
      hasPositiveSignal(pageSignals, ["repeatedAdFrames", "manyVisibleAds"]);

    if (knownAdHeavyDomain || highAdPressure) {
      resultEvidence.push(
        evidence(
          knownAdHeavyDomain ? "derived" : "observed",
          knownAdHeavyDomain ? "adHeavyDomain" : "adPressure",
          knownAdHeavyDomain ? host : "high",
          "allow stronger bounded cleanup"
        )
      );
      return buildResult({
        tier: TIERS.AD_HEAVY,
        protocol: PROTOCOLS.AD_HEAVY,
        confidence: knownAdHeavyDomain ? "high" : "medium",
        evidence: resultEvidence
      });
    }

    resultEvidence.push(evidence("unknown", "category", host, "use default"));
    return buildResult({
      tier: TIERS.STANDARD,
      protocol: PROTOCOLS.STANDARD,
      confidence: "low",
      evidence: resultEvidence,
      notes: ["unknown domains default to standard"]
    });
  }

  const api = Object.freeze({
    TIERS,
    PROTOCOLS,
    PROTECTED_DOMAINS,
    AD_HEAVY_DOMAINS,
    HOSTILE_DOMAINS,
    classifySitePolicy,
    domainMatches,
    normalizeHost
  });

  root.AttentionRedirectorSitePolicy = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
