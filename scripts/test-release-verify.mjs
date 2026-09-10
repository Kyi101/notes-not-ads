// The two predicates the release gate turns on. Both are pure, so they are
// tested directly rather than by driving the whole chain — the orchestration
// around them is just spawning npm, and a test that spent four minutes running
// the gates twice would stop being run.
import assert from "node:assert/strict";
import {
  describeArtifactClobber,
  describeDirtyTree,
  isBundleStale
} from "./release-verify.mjs";

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

// --- Refusing to overwrite an artifact that already exists ----------------
//
// A digest recorded with a store submission has to keep describing a file that
// exists. dist/notes-not-ads-1.0.3.zip was rebuilt at a later revision during
// the 1.0.4 work and quietly became a different archive, so the digest
// submitted with 1.0.3 matched nothing local afterwards.

// Nothing on disk yet: nothing to protect.
assert.equal(
  describeArtifactClobber({ version: "1.0.4", existingDigest: "", builtDigest: "abc" }),
  null
);

// A byte-identical rebuild is expected — the packager is deterministic, so
// re-running the gate on the same revision must not be an error.
assert.equal(
  describeArtifactClobber({ version: "1.0.4", existingDigest: "abc", builtDigest: "abc" }),
  null
);

// Different bytes under a version that already has an artifact: refuse, and say
// both digests so the operator can see which file is which.
const refusal = describeArtifactClobber({
  version: "1.0.3",
  existingDigest: "4585acbd",
  builtDigest: "7385c23a"
});
assert.ok(refusal, "a rebuild that changes the bytes must be refused");
assert.match(refusal, /Refusing to replace the existing 1\.0\.3 artifact/);
assert.match(refusal, /4585acbd/);
assert.match(refusal, /7385c23a/);
assert.match(refusal, /Bump the version instead/);

console.log("PASS release verify predicates");
