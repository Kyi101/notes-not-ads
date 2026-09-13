import assert from "node:assert/strict";
import {
  isManualLiveEvalCase,
  selectLiveEvalCases
} from "./live-eval-selection.mjs";

const cases = [
  { id: "regression", track: "regression" },
  { id: "controlled", track: "controlled" },
  { id: "discovery", track: "discovery" },
  { id: "manual-track", track: "manual" },
  { id: "manual-flag", track: "regression", manualOnly: true }
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

console.log("PASS live eval selection");
