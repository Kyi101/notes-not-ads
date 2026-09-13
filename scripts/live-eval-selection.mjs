export function isManualLiveEvalCase(testCase) {
  return testCase.manualOnly === true || testCase.track === "manual";
}

// The tracks the default automated run is allowed to visit. A whitelist rather
// than "everything except manual and discovery": the missing manualOnly flag on
// olx-ua-item failed open because the runner excluded by marker, and a
// misspelled track — "regresion" — would fail open the same way one level up.
// A case has to say it belongs here, or it does not run unattended.
export const DEFAULT_LIVE_EVAL_TRACKS = Object.freeze(["regression", "controlled"]);

export function isDefaultLiveEvalCase(testCase) {
  return (
    !isManualLiveEvalCase(testCase) &&
    DEFAULT_LIVE_EVAL_TRACKS.includes(testCase.track)
  );
}

export function selectLiveEvalCases(cases, options = {}) {
  if (options.url) {
    return [
      {
        id: options.customId || slugFromUrl(options.url),
        group: options.group || "custom",
        url: options.url,
        notes: "One-off URL supplied on the command line."
      }
    ];
  }

  let selected = [...cases];

  if (!options.group && !options.track && !options.caseId) {
    selected = selected.filter(isDefaultLiveEvalCase);
  }

  if (options.group) {
    selected = selected.filter((testCase) => testCase.group === options.group);
  }

  if (options.track) {
    selected = selected.filter((testCase) => testCase.track === options.track);
  }

  if (options.caseId) {
    selected = selected.filter((testCase) => testCase.id === options.caseId);
  }

  if (options.limit > 0) {
    selected = selected.slice(0, options.limit);
  }

  return selected;
}

function slugFromUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "").replace(/[^a-z0-9]+/gi, "-");
  } catch (_error) {
    return "custom-url";
  }
}
