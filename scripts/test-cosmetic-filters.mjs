import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const source = await readFile(
  path.join(projectRoot, "src/cosmetic-filters.js"),
  "utf8"
);

const sandbox = {
  globalThis: {}
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, {
  filename: "src/cosmetic-filters.js"
});

const api = sandbox.AttentionRedirectorCosmeticFilters;
if (!api) {
  throw new Error("Cosmetic filter API was not exposed.");
}

const sample = `
! comment
##.generic-ad
example.com##.domain-ad
example.com,~news.example.com##.excluded-on-news
example.com#@#.domain-ad
example.com#?#div:has-text(ad)
bad.example.com#$#.ad { display: none; }
`;

const parsed = api.parseCosmeticFilters(sample);
assertEqual(parsed.rules.length, 3, "supported rule count");
assertEqual(parsed.exceptions.length, 1, "exception count");

const exampleRules = api.getRulesForHost("www.example.com", sample);
assertSelectors(
  exampleRules,
  [".generic-ad", ".excluded-on-news"],
  "example.com rules"
);

const newsRules = api.getRulesForHost("news.example.com", sample);
assertSelectors(newsRules, [".generic-ad"], "excluded subdomain rules");

const otherRules = api.getRulesForHost("other.test", sample);
assertSelectors(otherRules, [".generic-ad"], "generic rules");

const amazonRules = api.getRulesForHost("www.amazon.com");
if (!amazonRules.some((rule) => rule.selector === ".s-left-ads-item")) {
  throw new Error("amazon.com left-rail sponsored ad cosmetic rule is missing.");
}

const pexelsRules = api.getRulesForHost("www.pexels.com");
assertSelectors(
  pexelsRules.filter((rule) => rule.source.startsWith("pexels.com##")),
  [
    '[class*="AIGCShared_container__"]',
    '[class*="FullWidth_wrapper__"]',
    '[class*="Inline_container__"]'
  ],
  "pexels.com affiliate/promo cosmetic rules"
);

const unsplashRules = api.getRulesForHost("unsplash.com");
if (!unsplashRules.some((rule) => rule.selector === '[data-ad="true"]')) {
  throw new Error("unsplash.com sponsored affiliate cosmetic rule is missing.");
}

const localRules = api.getRulesForHost("127.0.0.1");
if (!localRules.some((rule) => rule.selector === '[data-ad="true"]')) {
  throw new Error("local data-ad cosmetic fixture rule is missing.");
}

const { serializeCosmeticFilterDeclaration, COSMETIC_DECLARATION_REGEX } =
  await import("./update-lists.mjs");

if (/const DEFAULT_COSMETIC_FILTER_TEXT = `/.test(source)) {
  throw new Error(
    "src/cosmetic-filters.js stores filter text in a template literal; regenerate with scripts/update-lists.mjs."
  );
}
if (!COSMETIC_DECLARATION_REGEX.test(source)) {
  throw new Error("update-lists.mjs regex no longer matches the shipped declaration.");
}

const hostileLines = [
  "##[data-x='${globalThis.pwned = true}']",
  "##.plain-ad",
  'example.com##[title="quote\\"and`backtick`"]',
  "##.trailing-backslash\\",
  "##.dollar-patterns $& $' $` $1"
];
const hostileDeclaration = serializeCosmeticFilterDeclaration(hostileLines);
const hostileSandbox = {};
vm.createContext(hostileSandbox);
const hostileValue = vm.runInContext(
  `(() => { ${hostileDeclaration} return DEFAULT_COSMETIC_FILTER_TEXT; })()`,
  hostileSandbox
);
assertEqual(
  hostileValue,
  hostileLines.join("\n"),
  "hostile filter lines survive serialization verbatim"
);
assertEqual(
  hostileSandbox.pwned,
  undefined,
  "hostile filter lines must not execute"
);

console.log("PASS cosmetic filter parser");

function assertSelectors(rules, expected, label) {
  const actual = rules.map((rule) => rule.selector).sort();
  assertEqual(JSON.stringify(actual), JSON.stringify([...expected].sort()), label);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}
