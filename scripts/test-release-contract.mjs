import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const manifest = JSON.parse(
  await readFile(path.join(projectRoot, "manifest.json"), "utf8")
);
const backgroundSource = await readFile(
  path.join(projectRoot, "src/background.js"),
  "utf8"
);
const cosmeticSource = await readFile(
  path.join(projectRoot, "src/cosmetic-filters.js"),
  "utf8"
);

const permissions = Array.isArray(manifest.permissions)
  ? manifest.permissions
  : [];

if (!permissions.includes("declarativeNetRequest")) {
  throw new Error("Release contract violation: DNR permission is required.");
}

const ruleResources = manifest.declarative_net_request?.rule_resources || [];
const ruleIds = new Set(ruleResources.map((resource) => resource.id));

["ruleset_1", "easylist"].forEach((rulesetId) => {
  if (!ruleIds.has(rulesetId)) {
    throw new Error(`Release contract violation: missing ${rulesetId}.`);
  }
});

for (const resource of ruleResources) {
  const rules = JSON.parse(
    await readFile(path.join(projectRoot, resource.path), "utf8")
  );
  if (!Array.isArray(rules) || rules.length < 1) {
    throw new Error(`Ruleset ${resource.id} is empty or invalid.`);
  }

  if (resource.id === "ruleset_1") {
    assertRulesInclude(
      rules,
      [
        "attention-redirector-dnr-probe.js",
        "ads.js",
        "widget/ads",
        "||adblock.turtlecute.org/js/pagead.js",
        "||ads.spotify.com^",
        "||cdn.teads.tv^",
        "||ads.pubmatic.com^",
        "||metrika.yandex.ru^",
        "||imasdk.googleapis.com^",
        "||revcontent.com^",
        "||applovin.com^",
        "||mixpanel.com^",
        "||crwdcntrl.net^",
        "||sdkconfig.ad.xiaomi.com^"
      ],
      "hand-curated DNR seed"
    );
  }
}

[
  "adblock.turtlecute.org##.adbox.banner_ads.adsbox",
  "adblock.turtlecute.org##.textads"
].forEach((selector) => {
  if (!cosmeticSource.includes(selector)) {
    throw new Error(`Release contract violation: missing cosmetic seed ${selector}.`);
  }
});

if (!backgroundSource.includes("updateEnabledRulesets")) {
  throw new Error("Release contract violation: background must toggle rulesets.");
}

if (!backgroundSource.includes("updateSessionRules")) {
  throw new Error(
    "Release contract violation: background must install per-site allow rules."
  );
}

if (!backgroundSource.includes("AR_SYNC_PAGE_DNR_ALLOW")) {
  throw new Error(
    "Release contract violation: content-sensitive pages must be able to request tab-level DNR allow rules."
  );
}

console.log("PASS release product contract");

function assertRulesInclude(rules, urlFilters, label) {
  const actualFilters = new Set(
    rules.map((rule) => rule?.condition?.urlFilter).filter(Boolean)
  );

  for (const urlFilter of urlFilters) {
    if (!actualFilters.has(urlFilter)) {
      throw new Error(`${label}: missing ${urlFilter}.`);
    }
  }
}
