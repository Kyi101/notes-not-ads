import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const checker = path.join(__dirname, "check-paired-change.mjs");

async function check(files) {
  try {
    await run(process.execPath, [checker, "--files", ...files]);
    return null;
  } catch (error) {
    return String(error.stderr || error.message);
  }
}

async function expectPass(label, files) {
  const failure = await check(files);
  if (failure !== null) {
    throw new Error(`${label} should pass, but the check failed with: ${failure}`);
  }
}

async function expectFail(label, files) {
  const failure = await check(files);
  if (failure === null) {
    throw new Error(`${label} should fail, but the check passed.`);
  }
  if (!failure.includes("Paired-change violation")) {
    throw new Error(`${label} rejection did not explain itself: ${failure}`);
  }
}

await expectPass("an empty diff", []);
await expectPass("a docs-only diff", ["README.md", "docs/chrome-web-store.md"]);
await expectPass("an engine-only diff", ["src/replacer.js", "src/content.js"]);
await expectPass("a rules change with a fixture", [
  "rules/rules_1.json",
  "tests/fixtures/ad-clutter.html"
]);
await expectPass("a cosmetic change with an eval case", [
  "src/cosmetic-filters.js",
  "evals/live-sites.json"
]);
await expectPass("a fixture-only diff", ["tests/fixtures/ad-clutter.html"]);

await expectFail("a rules change with no case", ["rules/easylist_dnr.json"]);
await expectFail("a cosmetic change with no case", ["src/cosmetic-filters.js", "README.md"]);
await expectFail("a rules change paired only with a unit test", [
  "rules/rules_1.json",
  "scripts/test-release-contract.mjs"
]);

const usage = await (async () => {
  try {
    await run(process.execPath, [checker]);
    return null;
  } catch (error) {
    return String(error.stderr || error.message);
  }
})();
if (usage === null || !usage.includes("Usage:")) {
  throw new Error(`Calling the check with no mode should print usage, got: ${usage}`);
}

console.log("PASS paired-change tests");
