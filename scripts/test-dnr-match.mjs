// Asserts tests/fixtures/dnr-match-cases.json against Chrome's own DNR matcher.
//
// Live ad serving is probabilistic — on the regional streaming canary only 3 of
// 6 loads served an ad at all — so a browsing-based check cannot tell a fixed
// rule from a lucky page load. testMatchOutcome asks the engine directly.
//
// Usage: node scripts/test-dnr-match.mjs [fixture.json]

import { chromium } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const manifest = JSON.parse(await readFile(path.join(projectRoot, "manifest.json"), "utf8"));
const fixturePath = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(projectRoot, "tests/fixtures/dnr-match-cases.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));

// testMatchOutcome names the winning rule but not what it does, so a matched
// allow rule is indistinguishable from a matched block rule without this map.
const actionById = new Map();
for (const resource of manifest.declarative_net_request.rule_resources) {
  const rules = JSON.parse(await readFile(path.join(projectRoot, resource.path), "utf8"));
  for (const rule of rules) actionById.set(`${resource.id}:${rule.id}`, rule.action.type);
}

const userDataDir = await mkdtemp(path.join(os.tmpdir(), "ar-dnr-match-"));
const failures = [];
let context;

try {
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${projectRoot}`,
      `--load-extension=${projectRoot}`
    ]
  });

  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 30000 });
  await new Promise((resolve) => setTimeout(resolve, 4000));

  const enabled = await worker.evaluate(() =>
    chrome.declarativeNetRequest.getEnabledRulesets()
  );
  for (const resource of manifest.declarative_net_request.rule_resources) {
    if (resource.enabled && !enabled.includes(resource.id)) {
      failures.push(`ruleset ${resource.id} did not load (enabled: ${enabled.join(", ")})`);
    }
  }

  for (const testCase of fixture.cases) {
    const matched = await worker.evaluate(
      async ([url, type, initiator]) => {
        const outcome = await chrome.declarativeNetRequest.testMatchOutcome({
          url,
          type,
          initiator,
          method: "get"
        });
        return outcome.matchedRules;
      },
      [testCase.url, testCase.type, testCase.initiator]
    );

    const actions = matched.map(
      (match) => actionById.get(`${match.rulesetId}:${match.ruleId}`) || "unknown"
    );
    const actual = actions.includes("block") ? "block" : "allow";

    if (actual === testCase.expect) {
      console.log(`  ok   ${testCase.id}`);
    } else {
      console.log(`  FAIL ${testCase.id} — want ${testCase.expect}, got ${actual}`);
      failures.push(
        `${testCase.id}: want ${testCase.expect}, got ${actual} for ${testCase.url} (${testCase.why})`
      );
    }
  }
} finally {
  if (context) await context.close().catch(() => {});
  await rm(userDataDir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\nFAIL DNR match cases (${failures.length})`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`\nPASS DNR match cases (${fixture.cases.length} cases)`);
}
