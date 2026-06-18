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
