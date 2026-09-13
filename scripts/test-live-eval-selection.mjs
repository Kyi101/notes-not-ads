import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_LIVE_EVAL_TRACKS,
  isDefaultLiveEvalCase,
  isManualLiveEvalCase,
  selectLiveEvalCases
} from "./live-eval-selection.mjs";

const cases = [
  { id: "regression", track: "regression" },
  { id: "controlled", track: "controlled" },
  { id: "discovery", track: "discovery" },
  { id: "manual-track", track: "manual" },
  { id: "manual-flag", track: "regression", manualOnly: true },
  // A track that is neither known nor manual. Under a blacklist this would run
  // unattended; under the whitelist it must not.
  { id: "misspelled", track: "regresion" },
  { id: "unknown-track", track: "experimental" },
  { id: "no-track" }
];

assert.deepEqual(
  selectLiveEvalCases(cases, {}).map((testCase) => testCase.id),
  ["regression", "controlled"],
  "the default automated selection must contain only regression and controlled cases"
);

assert.deepEqual(
  selectLiveEvalCases(cases, { track: "manual" }).map(
    (testCase) => testCase.id
  ),
  ["manual-track"],
  "an explicit manual dry-run selection must remain available"
);

assert.deepEqual(
  selectLiveEvalCases(cases, { track: "discovery" }).map(
    (testCase) => testCase.id
  ),
  ["discovery"],
  "an explicit discovery selection must remain available"
);

assert.deepEqual(
  selectLiveEvalCases(cases, { caseId: "manual-track" }).map(
    (testCase) => testCase.id
  ),
  ["manual-track"],
  "an explicit case selection must remain available for a guarded dry run"
);

assert.equal(isManualLiveEvalCase(cases[3]), true);
assert.equal(isManualLiveEvalCase(cases[4]), true);
assert.equal(isManualLiveEvalCase(cases[0]), false);

// The whitelist and the predicate agree, including on the shapes that used to
// fail open.
assert.equal(isDefaultLiveEvalCase({ track: "regression" }), true);
assert.equal(isDefaultLiveEvalCase({ track: "controlled" }), true);
assert.equal(isDefaultLiveEvalCase({ track: "regression", manualOnly: true }), false);
assert.equal(isDefaultLiveEvalCase({ track: "regresion" }), false);
assert.equal(isDefaultLiveEvalCase({}), false);
assert.deepEqual([...DEFAULT_LIVE_EVAL_TRACKS], ["regression", "controlled"]);

// The real case file. A track that is not one the file itself declares is a
// typo, and under the whitelist a typo now means the case silently never runs
// anywhere — which is the safe direction, but still a case nobody will ever
// see. Catch it here, at check time, rather than in a dry run months later.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const live = JSON.parse(readFileSync(path.join(projectRoot, "evals/live-sites.json"), "utf8"));
const declaredTracks = new Set(Object.keys(live.tracks || {}));
const badTrack = live.cases.filter((c) => !declaredTracks.has(c.track));
assert.deepEqual(
  badTrack.map((c) => `${c.id}: ${JSON.stringify(c.track)}`),
  [],
  `evals/live-sites.json has cases whose track is not one the file declares (${[...declaredTracks].join(", ")})`
);

console.log("PASS live eval selection");
