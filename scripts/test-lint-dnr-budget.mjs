import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const linter = path.join(__dirname, "lint-dnr-budget.mjs");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "attention-redirector-dnr-budget-"));

let caseIndex = 0;

function rules(count, startId = 1) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      id: startId + i,
      priority: 1,
      action: { type: "block" },
      condition: { urlFilter: `||ads-${startId + i}.example^`, resourceTypes: ["script"] }
    });
  }
  return out;
}

// Each case gets its own directory because the linter resolves ruleset paths
// relative to the manifest it was handed.
async function lint(name, resources, files) {
  const dir = path.join(tempDir, `case-${caseIndex++}-${name.replace(/\W+/g, "-")}`);
  await mkdir(path.join(dir, "rules"), { recursive: true });
  for (const [file, body] of Object.entries(files)) {
    await writeFile(
      path.join(dir, file),
      typeof body === "string" ? body : JSON.stringify(body),
      "utf8"
    );
  }
  const manifestPath = path.join(dir, "manifest.json");
  await writeFile(
    manifestPath,
    JSON.stringify({
      manifest_version: 3,
      name: "budget fixture",
      version: "1.0.0",
      declarative_net_request: { rule_resources: resources }
    }),
    "utf8"
  );
  try {
    await run(process.execPath, [linter, manifestPath]);
    return null;
  } catch (error) {
    return String(error.stderr || error.message);
  }
}

async function expectPass(name, resources, files) {
  const failure = await lint(name, resources, files);
  if (failure !== null) {
    throw new Error(`${name} must pass, but the lint failed with: ${failure}`);
  }
}

async function expectReject(name, resources, files, expectedFragment) {
  const failure = await lint(name, resources, files);
  if (failure === null) {
    throw new Error(`${name} must be rejected, but the lint passed.`);
  }
  if (!failure.includes("DNR budget violation")) {
    throw new Error(`${name} rejection did not explain itself: ${failure}`);
  }
  if (!failure.includes(expectedFragment)) {
    throw new Error(`${name} rejection did not mention "${expectedFragment}": ${failure}`);
  }
}

try {
  await expectPass(
    "inside the budget",
    [{ id: "seed", enabled: true, path: "rules/seed.json" }],
    { "rules/seed.json": rules(1000) }
  );

  await expectPass(
    "exactly at the budget",
    [{ id: "seed", enabled: true, path: "rules/seed.json" }],
    { "rules/seed.json": rules(29000) }
  );

  await expectReject(
    "one rule over the budget",
    [{ id: "seed", enabled: true, path: "rules/seed.json" }],
    { "rules/seed.json": rules(29001) },
    "over the 29000"
  );

  // The failure the old per-file ceiling could not see: two rulesets that are
  // each individually plausible but together outspend the guarantee. Chrome
  // charges the sum, so the gate has to as well.
  await expectReject(
    "two rulesets summing over the budget",
    [
      { id: "seed", enabled: true, path: "rules/seed.json" },
      { id: "easylist", enabled: true, path: "rules/easylist.json" }
    ],
    { "rules/seed.json": rules(20000), "rules/easylist.json": rules(20000, 100000) },
    "over the 29000"
  );

  // Install-time disabled is not permanent: src/background.js can enable its
  // declared rulesets again when the user turns blocking back on.
  await expectReject(
    "a disabled ruleset still spends the reachable budget",
    [
      { id: "seed", enabled: true, path: "rules/seed.json" },
      { id: "tail", enabled: false, path: "rules/tail.json" }
    ],
    { "rules/seed.json": rules(1000), "rules/tail.json": rules(29000, 100000) },
    "over the 29000"
  );

  await expectReject(
    "a ruleset file that is missing",
    [{ id: "seed", enabled: true, path: "rules/absent.json" }],
    { "rules/seed.json": rules(10) },
    "could not be read"
  );

  await expectReject(
    "a ruleset file that is not an array",
    [{ id: "seed", enabled: true, path: "rules/seed.json" }],
    { "rules/seed.json": { rules: [] } },
    "not an array"
  );

  await expectReject(
    "a manifest declaring no rulesets",
    [],
    { "rules/seed.json": rules(10) },
    "no declarative_net_request.rule_resources"
  );

  console.log("PASS DNR budget lint tests");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
