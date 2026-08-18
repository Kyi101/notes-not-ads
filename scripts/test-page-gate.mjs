// The runtime page gate had no test, which is how the Google false positives
// shipped: `accounts.google.com` was excluded in the manifest while
// `myaccount.google.com` and `workspace.google.com` were not, and nothing
// noticed. The live smoke could not catch it either, because those surfaces
// need a login.
//
// The gate is pure hostname + path logic, so it can be answered offline for
// every surface at once. This runs the ACTUAL text of the content modules in a
// vm with a stubbed location, so it cannot drift from what ships.
//
// Two tiers are asserted, and the difference matters:
//   off   - no DOM replacement, request blocking stays on (product/app UIs)
//   none  - extension does nothing at all (money, credentials, private mail)
//   full  - replacement and blocking both active (the product's actual job)
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// build-content.mjs order, minus src/init.js which is the entry call.
const MODULES = ["shared", "main", "inspector", "scanner", "replacer"];
const body = (
  await Promise.all(
    MODULES.map((name) => readFile(path.join(projectRoot, `src/${name}.js`), "utf8"))
  )
).join("\n");

// The bundler wraps the modules in a function, so the sources may use top-level
// `return`. Reproduce that wrapper and hand the gate symbols back out.
const source = `function __gate(){\n${body}\n__out.isPageAllowed = isPageAllowed;\n__out.isDomReplacementAllowed = isDomReplacementAllowed;\n__out.SENSITIVE_DOMAINS = SENSITIVE_DOMAINS;\n}\n__gate();`;

const sandbox = {
  location: { hostname: "", pathname: "" },
  document: { body: null, querySelectorAll: () => [] },
  chrome: { runtime: {} },
  console,
  __out: {}
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.runInContext(source, vm.createContext(sandbox));

const gate = sandbox.__out;
for (const name of ["isPageAllowed", "isDomReplacementAllowed"]) {
  if (typeof gate[name] !== "function") {
    throw new Error(`gate symbol missing from the content modules: ${name}`);
  }
}

// The manifest keeps the content script off these hosts entirely, so the gate
// is never consulted there. Mirrored here so the test tells the whole truth.
const manifest = JSON.parse(
  await readFile(path.join(projectRoot, "manifest.json"), "utf8")
);
const manifestExcluded = (manifest.content_scripts || [])
  .flatMap((entry) => entry.exclude_matches || [])
  .map((pattern) => pattern.replace(/^https?:\/\//, "").replace(/\/.*$/, ""));

// The background worker keeps its own copy so the allow rules exist before the
// first request. The two drifting is precisely how a host ends up half
// protected, so require them to be identical.
const backgroundSource = await readFile(path.join(projectRoot, "src/background.js"), "utf8");
const backgroundList = backgroundSource.match(/const SENSITIVE_DNR_DOMAINS = (\[[^\]]*\]);/);
if (!backgroundList) {
  throw new Error("could not read SENSITIVE_DNR_DOMAINS from src/background.js");
}
const dnrDomains = JSON.parse(backgroundList[1].replace(/,(\s*])/, "$1"));
const sharedDomains = gate.SENSITIVE_DOMAINS;
const onlyShared = sharedDomains.filter((d) => !dnrDomains.includes(d));
const onlyBackground = dnrDomains.filter((d) => !sharedDomains.includes(d));

if (onlyShared.length || onlyBackground.length) {
  console.error("SENSITIVE_DOMAINS and SENSITIVE_DNR_DOMAINS have drifted:\n");
  for (const d of onlyShared) console.error(`  only in src/shared.js:     ${d}`);
  for (const d of onlyBackground) console.error(`  only in src/background.js: ${d}`);
  process.exit(1);
}

const CASES = [
  // --- Google products. Reported by Hlib 2026-08-16: the extension replaced
  // surfaces during Workspace registration and on Google Account itself.
  ["https://myaccount.google.com/", "off", "Google Account home"],
  ["https://myaccount.google.com/personal-info", "off", "Google Account personal info"],
  ["https://myaccount.google.com/data-and-privacy", "off", "Google Account data & privacy"],
  ["https://workspace.google.com/", "off", "Workspace marketing"],
  ["https://workspace.google.com/business/signup/welcome", "off", "Workspace registration"],
  ["https://admin.google.com/ac/home", "off", "Workspace Admin console"],
  ["https://ads.google.com/aw/campaigns", "off", "Google Ads"],
  ["https://analytics.google.com/analytics/web/", "off", "Google Analytics"],
  ["https://console.cloud.google.com/home/dashboard", "off", "Google Cloud console"],
  ["https://news.google.com/", "off", "Google News — replaced its own logo, 2026-08-16"],
  ["https://photos.google.com/", "off", "Google Photos"],
  ["https://meet.google.com/abc-defg-hij", "off", "Google Meet"],
  ["https://gemini.google.com/app", "off", "Gemini"],
  ["https://play.google.com/store/apps", "off", "Play Store"],
  ["https://support.google.com/accounts/answer/1234", "off", "Google Support"],

  // --- Other vendor product surfaces.
  ["https://portal.azure.com/", "off", "Azure portal"],
  ["https://admin.microsoft.com/", "off", "Microsoft 365 admin"],
  ["https://teams.microsoft.com/", "off", "Teams"],
  ["https://outlook.office.com/mail/", "off", "Outlook web"],
  ["https://github.com/Kyi101/notes-not-ads", "off", "GitHub"],
  ["https://chatgpt.com/", "off", "ChatGPT"],
  ["https://platform.openai.com/usage", "off", "OpenAI platform"],
  ["https://claude.ai/chats", "off", "Claude"],
  ["https://console.aws.amazon.com/console/home", "off", "AWS console"],
  ["https://dash.cloudflare.com/", "off", "Cloudflare dash"],
  ["https://app.slack.com/client/T1/C1", "off", "Slack"],
  ["https://admin.shopify.com/store/x/products", "off", "Shopify admin"],
  ["https://acme.atlassian.net/jira/software/projects/X/boards/1", "off", "Jira tenant"],
  ["https://acme.sharepoint.com/sites/team", "off", "SharePoint tenant"],
  ["https://acme.lightning.force.com/lightning/page/home", "off", "Salesforce tenant"],
  ["https://icloud.com/mail", "off", "iCloud"],
  // --- Marketing, analytics, and ad-platform consoles. Reported by Hlib
  // 2026-08-17: the GA dashboard broke; the class is every console whose UI
  // is full of ad-bearing class names.
  ["https://ads.tiktok.com/i18n/dashboard", "off", "TikTok Ads Manager"],
  ["https://ads.pinterest.com/advertiser/1/reporting", "off", "Pinterest Ads"],
  ["https://business.facebook.com/adsmanager", "off", "Meta Ads Manager"],
  ["https://mixpanel.com/project/1/view/1/app/boards", "off", "Mixpanel"],
  ["https://app.amplitude.com/analytics/demo/home", "off", "Amplitude"],
  ["https://backstage.taboola.com/backstage/", "off", "Taboola Backstage"],
  ["https://metrika.yandex.ru/dashboard", "off", "Yandex Metrica"],
  ["https://insights.hotjar.com/sites", "off", "Hotjar"],

  // --- Zero-footprint tier: money, credentials, private mail.
  ["https://vault.bitwarden.com/", "none", "Bitwarden vault"],
  ["https://my.1password.com/vaults", "none", "1Password"],
  ["https://schwab.com/accounts", "none", "Brokerage"],
  ["https://pay.google.com/", "none", "Google Pay"],
  ["https://chase.com/", "none", "Bank — already shipped"],
  ["https://mail.google.com/mail/u/0/", "none", "Gmail — manifest excluded"],
  ["https://drive.google.com/drive/my-drive", "none", "Drive — manifest excluded"],
  ["https://accounts.google.com/signin", "none", "Sign-in — manifest excluded"],
  ["https://www.notion.so/workspace", "none", "Notion — already shipped"],

  // --- Deliberately still in scope. Search carries ads and Hlib wants them
  // handled; the exclusion is for products, not for search results.
  ["https://www.google.com/search?q=car+insurance", "full", "Google Search stays in scope"],
  ["https://www.bing.com/search?q=car+insurance", "full", "Bing stays in scope"],
  ["https://www.tiktok.com/foryou", "full", "consumer TikTok stays in scope — only ads.tiktok.com is a console"],
  ["https://www.pinterest.com/ideas/", "full", "consumer Pinterest stays in scope — only ads.pinterest.com is a console"],

  // --- The product's actual job. If these ever flip, the fix went too far.
  ["https://www.tomsguide.com/", "full", "ad-heavy publisher"],
  ["https://nypost.com/", "full", "ad-heavy publisher"],
  ["https://www.forbes.com/", "full", "ad-heavy publisher"],
  ["https://www.dailymail.co.uk/news/index.html", "full", "ad-heavy publisher"],
  ["https://screenrant.com/", "full", "ad-heavy publisher"],
  ["https://www.espn.com/", "full", "ad-heavy publisher"],

  // --- Path rules must survive the domain additions.
  ["https://shop.example.com/checkout", "none", "checkout path"],
  ["https://shop.example.com/cart", "none", "cart path"],
  ["https://example.com/login", "none", "login path"],
  ["https://example.com/", "full", "ordinary page"]
];

const settings = { enabled: true, disabledDomains: [] };
const failures = [];

for (const [url, expected, label] of CASES) {
  const parsed = new URL(url);
  sandbox.location.hostname = parsed.hostname;
  sandbox.location.pathname = parsed.pathname;

  const excludedByManifest = manifestExcluded.includes(parsed.hostname);
  const pageAllowed = excludedByManifest ? false : gate.isPageAllowed(settings);
  const domAllowed = excludedByManifest ? false : gate.isDomReplacementAllowed(settings);

  const actual = !pageAllowed ? "none" : domAllowed ? "full" : "off";

  if (actual !== expected) {
    failures.push({ url, expected, actual, label });
  }
}

if (failures.length) {
  const width = Math.max(...failures.map((f) => f.url.length));
  console.error("Page gate mismatches:\n");
  for (const f of failures) {
    console.error(
      `  ${f.url.padEnd(width)}  expected=${f.expected.padEnd(4)} actual=${f.actual.padEnd(4)}  ${f.label}`
    );
  }
  console.error(`\n${failures.length} of ${CASES.length} page-gate cases failed.`);
  process.exit(1);
}

console.log(`Page gate OK — ${CASES.length} surfaces classified as expected.`);
