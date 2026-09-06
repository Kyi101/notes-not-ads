// The two predicates the release gate turns on. Both are pure, so they are
// tested directly rather than by driving the whole chain — the orchestration
// around them is just spawning npm, and a test that spent four minutes running
// the gates twice would stop being run.
import assert from "node:assert/strict";
import { describeDirtyTree, isBundleStale } from "./release-verify.mjs";

// A clean tree prints nothing at all.
assert.equal(describeDirtyTree(""), null);
assert.equal(describeDirtyTree("\n"), null);
assert.equal(describeDirtyTree(undefined), null);

// One line per changed tracked path, two status columns then the path.
assert.deepEqual(describeDirtyTree(" M src/scanner.js\n"), ["src/scanner.js"]);
// Tracked changes are reported; the untracked one here is outside every packaged
// directory, so it is deliberately not.
assert.deepEqual(describeDirtyTree("M  a.js\n A b.js\n?? c.js\n"), ["a.js", "b.js"]);

// CRLF, because git on Windows is where this gate matters most and where #6
// showed line endings are not hypothetical.
assert.deepEqual(describeDirtyTree(" M a.js\r\n M b.js\r\n"), ["a.js", "b.js"]);

// Untracked files are ignored — STATUS.md, runs/ and dist/ are untracked by
// design and must not block a release.
assert.equal(describeDirtyTree("?? STATUS.md\n?? runs/x.log\n?? dist/a.zip\n"), null);

// Except inside the directories the packager collects by scanning, where an
// untracked file ships without ever having been committed. That is the exact
// traceability this gate exists to guarantee.
assert.deepEqual(describeDirtyTree("?? icons/icon-256.png\n"), [
  "icons/icon-256.png (untracked, but inside a packaged directory)"
]);
assert.deepEqual(describeDirtyTree("?? fonts/new.woff2\n?? notes.txt\n"), [
  "fonts/new.woff2 (untracked, but inside a packaged directory)"
]);

// Staleness is byte equality, with line endings normalized first so that a CRLF
// checkout does not report a correct bundle as stale.
assert.equal(isBundleStale("(() => {})();\n", "(() => {})();\n"), false);
assert.equal(isBundleStale("(() => {})();\r\n", "(() => {})();\n"), false);
assert.equal(isBundleStale("(() => { old })();\n", "(() => { new })();\n"), true);

// The failure this gate exists for: a partial was edited and never rebuilt, so
// the committed bundle is missing the change that is about to ship.
assert.equal(
  isBundleStale("function scan() { return 1; }", "function scan() { return 2; }"),
  true
);

console.log("PASS release verify predicates");
