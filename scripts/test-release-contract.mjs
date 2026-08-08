import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
// 30000 is Chrome's guaranteed minimum, not a per-ruleset cap. Measured: the
// packaged build loads 52169 static rules with 277648 pool slots still free.
// The ceiling below is a guard against unbounded list growth, and it applies to
// the total across rulesets because that is what Chrome actually budgets.
const MAX_STATIC_RULES_TOTAL = 60000;

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

let totalStaticRules = 0;

for (const resource of ruleResources) {
  const rules = JSON.parse(
    await readFile(path.join(projectRoot, resource.path), "utf8")
  );
  if (!Array.isArray(rules) || rules.length < 1) {
    throw new Error(`Ruleset ${resource.id} is empty or invalid.`);
  }

  totalStaticRules += rules.length;

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
        "||video.unocdn.com/*_fix.mp4",
        "/code/video-steam/"
      ],
      "hand-curated DNR seed"
    );
  }
}

if (totalStaticRules > MAX_STATIC_RULES_TOTAL) {
  throw new Error(
    `Release contract violation: ${totalStaticRules} static rules across rulesets exceeds the ${MAX_STATIC_RULES_TOTAL} ceiling. Chrome drops an oversized ruleset whole.`
  );
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

// The packager ships an explicit allowlist rather than the working tree, so an
// asset added to a page but not to that list is simply absent from the store
// build and the page loads unstyled. Nothing local notices: the unpacked
// extension loads the file straight off disk, and every gate here runs unpacked.
const packagerSource = await readFile(
  path.join(projectRoot, "scripts/package-release.mjs"),
  "utf8"
);
const packagedPaths = readStringList(packagerSource, "requiredReleasePaths");
const packagedDirs = readStringList(packagerSource, "optionalReleaseDirs");

for (const page of ["popup.html", "options.html", "welcome.html"]) {
  const pageSource = await readFile(path.join(projectRoot, page), "utf8");
  const references = Array.from(
    pageSource.matchAll(/(?:href|src)="([^"]+)"/g),
    (match) => match[1]
  ).filter((reference) => !/^(?:[a-z]+:|\/\/|#)/i.test(reference));

  for (const reference of references) {
    const asset = reference.replace(/^\.\//, "").split(/[?#]/)[0];
    const shipped =
      packagedPaths.has(asset) ||
      [...packagedDirs].some((dir) => asset.startsWith(`${dir}/`));
    if (!shipped) {
      throw new Error(
        `Release contract violation: ${page} loads ${asset}, which scripts/package-release.mjs does not ship.`
      );
    }
  }
}

console.log("PASS release product contract");

function readStringList(source, name) {
  const declaration = source.match(
    new RegExp(`const ${name} = \\[([^\\]]*)\\]`)
  );
  if (!declaration) {
    throw new Error(
      `Release contract violation: cannot read ${name} from the release packager.`
    );
  }
  return new Set(
    Array.from(declaration[1].matchAll(/"([^"]+)"/g), (match) => match[1])
  );
}

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
