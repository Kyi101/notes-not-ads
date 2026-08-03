import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const FILTER_DATA = /^(rules\/|src\/cosmetic-[^/]*\.js$)/;
const SUPPORTING_CASE = /^(tests\/fixtures\/|evals\/)/;

const args = process.argv.slice(2);
const filesIndex = args.indexOf("--files");
const baseIndex = args.indexOf("--base");

let changed;

if (filesIndex > -1) {
  changed = args.slice(filesIndex + 1).filter((value) => !value.startsWith("--"));
} else if (baseIndex > -1) {
  const base = args[baseIndex + 1];
  if (!base) {
    throw new Error("Usage: check-paired-change.mjs --base <ref> | --files <path...>");
  }
  const { stdout } = await run("git", ["diff", "--name-only", `${base}...HEAD`], {
    cwd: projectRoot,
    maxBuffer: 16 * 1024 * 1024
  });
  changed = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
} else {
  throw new Error("Usage: check-paired-change.mjs --base <ref> | --files <path...>");
}

const filterChanges = changed.filter((file) => FILTER_DATA.test(file));

if (filterChanges.length < 1) {
  console.log("PASS paired-change check (no filter data touched)");
} else {
  const cases = changed.filter((file) => SUPPORTING_CASE.test(file));

  if (cases.length < 1) {
    throw new Error(
      [
        "Paired-change violation: this change edits filter data but adds no case that proves it.",
        `  Filter files changed: ${filterChanges.join(", ")}`,
        "",
        "Add a fixture under tests/fixtures/ or a case in evals/live-sites.json in the same change.",
        "AGENTS.md already requires deterministic coverage alongside a rule change; this check makes",
        "it mechanical. The case is also what a reviewer reads to judge whether the rule is correct."
      ].join("\n")
    );
  }

  console.log(
    `PASS paired-change check (${filterChanges.length} filter file(s), ${cases.length} supporting case file(s))`
  );
}
