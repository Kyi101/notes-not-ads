import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const checker = path.join(__dirname, "check-paired-change.mjs");

async function runChecker(args, { cwd } = {}) {
  try {
    await run(process.execPath, [checker, ...args], cwd ? { cwd } : {});
    return null;
  } catch (error) {
    return String(error.stderr || error.message);
  }
}

async function expectPass(label, files, opts) {
  const failure = await runChecker(files.length > 0 ? ["--files", ...files] : [], opts);
  if (failure !== null) {
    throw new Error(`${label} should pass, but the check failed with: ${failure}`);
  }
}

async function expectFail(label, files, opts) {
  const failure = await runChecker(files.length > 0 ? ["--files", ...files] : [], opts);
  if (failure === null) {
    throw new Error(`${label} should fail, but the check passed.`);
  }
  if (!failure.includes("Paired-change violation")) {
    throw new Error(`${label} rejection did not explain itself: ${failure}`);
  }
}

// --files mode: synthetic diff cases
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

// Usage error cases
const noMode = await runChecker([]);
if (noMode === null || !noMode.includes("Usage:")) {
  throw new Error(`calling with no mode should print usage, got: ${noMode}`);
}

const baseThenFiles = await runChecker(["--base", "--files"]);
if (baseThenFiles === null || !baseThenFiles.includes("Usage:")) {
  throw new Error(`--base --files should throw usage, but got: ${baseThenFiles}`);
}

const filesNoPath = await runChecker(["--files"]);
if (filesNoPath === null || !filesNoPath.includes("Usage:")) {
  throw new Error(`--files with no paths should throw usage, but got: ${filesNoPath}`);
}

const dashRef = await runChecker(["--base", "-p"]);
if (dashRef === null || dashRef.includes("PASS")) {
  throw new Error(`--base -p should throw error, not pass. Got: ${dashRef}`);
}

// --base mode: throwaway git repositories

// Helper: run a git command inside a tmp repo
async function git(cwd, ...args) {
  await run("git", args, { cwd });
}

// Test 1 — deleting the fixture must not satisfy the pairing requirement.
// A contributor who edits a filter file and removes its fixture should be rejected.
{
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "pcc-test-"));
  try {
    await git(tmpDir, "init");
    await git(tmpDir, "config", "user.email", "test@example.com");
    await git(tmpDir, "config", "user.name", "Test");

    // First commit: filter file and fixture both present, using the real path patterns
    await mkdir(path.join(tmpDir, "rules"));
    await mkdir(path.join(tmpDir, "tests", "fixtures"), { recursive: true });
    await writeFile(path.join(tmpDir, "rules", "rules_1.json"), '{"id":1}');
    await writeFile(path.join(tmpDir, "tests", "fixtures", "ad-clutter.html"), "<html></html>");
    await git(tmpDir, "add", ".");
    await git(tmpDir, "commit", "-m", "initial");
    const { stdout: sha1Out } = await run("git", ["rev-parse", "HEAD"], { cwd: tmpDir });
    const base = sha1Out.trim();

    // Second commit: edit the filter file, delete the fixture — no replacement added
    await writeFile(path.join(tmpDir, "rules", "rules_1.json"), '{"id":2}');
    await git(tmpDir, "rm", "tests/fixtures/ad-clutter.html");
    await git(tmpDir, "add", "rules/rules_1.json");
    await git(tmpDir, "commit", "-m", "edit filter, delete fixture");

    // The diff now contains rules/rules_1.json (modified) but no supporting case —
    // the deleted fixture is excluded by --diff-filter=d, so the check must reject.
    const result = await runChecker(["--base", base], { cwd: tmpDir });
    if (result === null || !result.includes("Paired-change violation")) {
      throw new Error(
        `deletion alone must not satisfy the pairing: expected rejection, got: ${result}`
      );
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// Test 2 — deleting a fixture and adding a replacement must pass.
// A legitimate fixture rename or replacement must not be blocked.
{
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "pcc-test-"));
  try {
    await git(tmpDir, "init");
    await git(tmpDir, "config", "user.email", "test@example.com");
    await git(tmpDir, "config", "user.name", "Test");

    // First commit: filter file and fixture both present
    await mkdir(path.join(tmpDir, "rules"));
    await mkdir(path.join(tmpDir, "tests", "fixtures"), { recursive: true });
    await writeFile(path.join(tmpDir, "rules", "rules_1.json"), '{"id":1}');
    await writeFile(path.join(tmpDir, "tests", "fixtures", "old-case.html"), "<html></html>");
    await git(tmpDir, "add", ".");
    await git(tmpDir, "commit", "-m", "initial");
    const { stdout: sha1Out } = await run("git", ["rev-parse", "HEAD"], { cwd: tmpDir });
    const base = sha1Out.trim();

    // Second commit: edit filter file, delete old fixture, add a replacement fixture
    await writeFile(path.join(tmpDir, "rules", "rules_1.json"), '{"id":2}');
    await git(tmpDir, "rm", "tests/fixtures/old-case.html");
    await mkdir(path.join(tmpDir, "tests", "fixtures"), { recursive: true });
    await writeFile(path.join(tmpDir, "tests", "fixtures", "new-case.html"), "<html><body>v2</body></html>");
    await git(tmpDir, "add", ".");
    await git(tmpDir, "commit", "-m", "edit filter, replace fixture");

    // new-case.html is an addition and survives --diff-filter=d, so the check must pass.
    const result = await runChecker(["--base", base], { cwd: tmpDir });
    if (result !== null) {
      throw new Error(
        `deletion plus replacement must pass, but check rejected with: ${result}`
      );
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

console.log("PASS paired-change tests");
