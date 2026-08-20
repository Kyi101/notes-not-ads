// Keeps the packaged static DNR rulesets inside the only rule allowance Chrome
// actually promises this extension.
//
// Chrome gives each extension GUARANTEED_MINIMUM_STATIC_RULES (30000) rules
// across its enabled static rulesets. Anything above that is drawn from a
// single global pool shared with every other installed extension, handed out
// first-come-first-served. Measured on Chrome 140 (see DECISIONS.md): the pool
// is 300000, and when it is empty an over-budget ruleset is refused **whole** —
// `updateEnabledRulesets` rejects with "The set of enabled rulesets exceeds the
// rule count limit.", `getEnabledRulesets()` simply never lists it, and nothing
// surfaces to the user. The extension keeps running and quietly stops blocking.
//
// So a ruleset that only fits because the pool happened to be empty is not
// shipped, it is gambled. This gate spends only the guaranteed allowance.
//
// Deliberately re-implemented rather than importing scripts/update-lists.mjs:
// a gate that shares code with what it inspects cannot catch that code being
// wrong, and the generator's own ceiling is exactly what was wrong before.
//
// Usage: node scripts/lint-dnr-budget.mjs [manifest.json]

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const GUARANTEED_MINIMUM_STATIC_RULES = 30000;

// Session rules are charged against the same allowance as static rules.
// Measured: with every static ruleset disabled, getAvailableStaticRuleCount()
// reported 329954 rather than 330000, exactly the 46 session rules
// src/background.js had installed for the sensitive-domain allow list. Those
// rules grow with use — one per user-disabled site, one per tab told to allow
// requests — so the static list cannot be allowed to spend the whole guarantee.
const SESSION_RULE_RESERVE = 1000;

const STATIC_RULE_BUDGET = GUARANTEED_MINIMUM_STATIC_RULES - SESSION_RULE_RESERVE;

const manifestPath = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(projectRoot, "manifest.json");
const manifestDir = path.dirname(manifestPath);

function violation(message) {
  throw new Error(`DNR budget violation: ${message}`);
}

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch (error) {
  violation(`${path.relative(projectRoot, manifestPath) || manifestPath} is not valid JSON — ${error.message}`);
}

const resources = manifest?.declarative_net_request?.rule_resources;
if (!Array.isArray(resources) || resources.length < 1) {
  violation("the manifest declares no declarative_net_request.rule_resources.");
}

let total = 0;
const lines = [];

for (const resource of resources) {
  if (typeof resource?.path !== "string" || !resource.path) {
    violation(`ruleset "${resource?.id}" has no path.`);
  }

  // Count every packaged ruleset, including one disabled at install. The
  // service worker toggles declared rulesets back on when blocking is enabled,
  // so install-time state is not a safe exemption from the reachable budget.

  const rulePath = path.resolve(manifestDir, resource.path);
  let rules;
  try {
    rules = JSON.parse(await readFile(rulePath, "utf8"));
  } catch (error) {
    violation(`ruleset "${resource.id}" (${resource.path}) could not be read — ${error.message}`);
  }
  if (!Array.isArray(rules)) {
    violation(`ruleset "${resource.id}" (${resource.path}) is not an array of rules.`);
  }

  total += rules.length;
  const installState = resource.enabled === true ? "enabled at install" : "disabled at install";
  lines.push(`  ${resource.id}: ${rules.length} rules (${installState})`);
}

for (const line of lines) console.log(line);
console.log(`  total packaged static rules: ${total} of ${STATIC_RULE_BUDGET}`);

if (total > STATIC_RULE_BUDGET) {
  violation(
    `packaged static rulesets hold ${total} rules, over the ${STATIC_RULE_BUDGET} this extension can count on ` +
      `(${GUARANTEED_MINIMUM_STATIC_RULES} guaranteed minus ${SESSION_RULE_RESERVE} reserved for session rules). ` +
      `The excess ${total - STATIC_RULE_BUDGET} rules only load while the browser-wide pool has room, and on a ` +
      `browser that already runs another filtering extension Chrome drops an over-budget ruleset whole and silently. ` +
      `Shrink the generated list with scripts/update-lists.mjs rather than raising this number.`
  );
}

console.log("PASS DNR budget lint");
