import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const MAX_STATIC_RULES_PER_RULESET = 30000;

const manifest = JSON.parse(
  await readFile(path.join(projectRoot, "manifest.json"), "utf8")
);
const backgroundSource = await readFile(
  path.join(projectRoot, "src/background.js"),
  "utf8"
);
const mainContentSource = await readFile(
  path.join(projectRoot, "src/main.js"),
  "utf8"
);
const popupSource = await readFile(path.join(projectRoot, "popup.js"), "utf8");
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

  if (rules.length > MAX_STATIC_RULES_PER_RULESET) {
    throw new Error(
      `Ruleset ${resource.id} has ${rules.length} rules; keep each MV3 static ruleset at or below ${MAX_STATIC_RULES_PER_RULESET}.`
    );
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
        "||youtube.com/pagead/",
        "||youtube.com/api/stats/ads",
        "||fwmrm.net^",
        "||metrika.yandex.ru^",
        "||imasdk.googleapis.com^",
        "||revcontent.com^",
        "||applovin.com^",
        "||mixpanel.com^",
        "||crwdcntrl.net^",
        "||bidmatic.io^",
        "||rcvlink.com^",
        "||onetag-sys.com^",
        "||sdkconfig.ad.xiaomi.com^",
        "||franecki.net/assets/vendor/",
        "||franecki.net/assets/pack/",
        "||franecki.net/js/ma.js",
        "||franecki.net/content/static/",
        "||reichelcormier.bid/candy/",
        "||nogravity4.click^",
        "||base.ashdi.vip/stats/stats_vast.php",
        "||video.unocdn.com/*_fix.mp4"
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

const manifestText = JSON.stringify(manifest);
if (!manifestText.includes("src/youtube-prune-loader.js")) {
  throw new Error(
    "Release contract violation: YouTube prune loader must be registered."
  );
}

if (!manifestText.includes("src/youtube-prune-main.js")) {
  throw new Error(
    "Release contract violation: YouTube prune main-world script must be web-accessible."
  );
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

if (
  popupSource.includes("AR_START_MISSED_AD_REPORT") &&
  !mainContentSource.includes("AR_START_MISSED_AD_REPORT")
) {
  throw new Error(
    "Release contract violation: popup report flow must have a content-script listener."
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
