export function isManualLiveEvalCase(testCase) {
  return testCase.manualOnly === true || testCase.track === "manual";
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
    selected = selected.filter((testCase) => {
      return !isManualLiveEvalCase(testCase) && testCase.track !== "discovery";
    });
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
