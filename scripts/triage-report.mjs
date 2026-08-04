// Tier-1 triage: read one issue, print what is deterministically true about it.
//
// This does no judging. It answers questions with one right answer — which form
// was used, which host, which required fields came back empty, whether the
// reporter already ruled the extension in or out — so the maintainer opens the
// issue already knowing whether it can be worked at all. Anything requiring taste
// is left alone on purpose: a triage bot that guesses wrong is worse than none,
// because its labels get trusted.
//
// Reads ISSUE_TITLE and ISSUE_BODY from the environment and prints JSON.

import { ISSUE_FORMS, REPORT_HEADINGS } from "./report-contract.mjs";
import { pathToFileURL } from "node:url";

const NO_RESPONSE = "_No response_";

// Answers that decide priority without anyone reading the issue.
const BREAKING_SURFACES = new Set([
  "Sign-in or account access",
  "Checkout or payment",
  "A form I could not submit"
]);

const SEVERE_FALSE_POSITIVES = new Set([
  "Lost a control I needed to use",
  "Lost content I wanted to read"
]);

const FORMS = Object.values(ISSUE_FORMS);

// GitHub renders a form response as "### <label>" blocks. Anything else in the
// body is the reporter writing freely, which triage does not parse.
export function parseIssueBody(body) {
  const sections = new Map();
  const parts = body.split(/^###[ \t]+(.+?)[ \t]*$/m);

  for (let index = 1; index < parts.length; index += 2) {
    sections.set(parts[index].trim(), parts[index + 1].trim());
  }

  return sections;
}

function answered(value) {
  return Boolean(value) && value !== NO_RESPONSE;
}

// Origin plus path is what the forms ask for and what the extension produces, so
// a query string here means someone pasted a raw URL past both.
function readHost(value) {
  if (!answered(value)) return null;
  const match = value.match(/https?:\/\/[^\s)>\]]+/);
  if (!match) return null;
  try {
    return new URL(match[0]).hostname.toLowerCase();
  } catch (error) {
    return null;
  }
}

// Only the page URL is promised to arrive stripped. Resource URLs on the Sources
// line keep their query strings on purpose — an ad tag's parameters are usually
// the only thing naming the network — so scanning the whole body would flag every
// well-formed report.
function carriesUnredactedPageUrl(site, report) {
  const candidates = [];
  if (answered(site)) candidates.push(site);
  for (const line of (report || "").split("\n")) {
    if (line.startsWith("Page: ")) candidates.push(line.slice(6));
  }

  return candidates.some((candidate) => {
    const match = candidate.match(/https?:\/\/[^\s)>\]]+/);
    if (!match) return false;
    try {
      const parsed = new URL(match[0]);
      return Boolean(parsed.search || parsed.hash);
    } catch (error) {
      return false;
    }
  });
}

export function triage({ title = "", body = "" } = {}) {
  const form = FORMS.find((candidate) => title.startsWith(candidate.titlePrefix));

  if (!form) {
    return {
      kind: "unknown",
      host: null,
      missing: [],
      severity: "normal",
      addLabels: ["needs-form"],
      flags: ["title-has-no-form-prefix"],
      actionable: false
    };
  }

  const sections = parseIssueBody(body);
  const values = {};
  const missing = [];

  for (const [field, heading] of Object.entries(form.fields)) {
    const value = sections.get(heading);
    values[field] = answered(value) ? value : null;
    if (!answered(value)) missing.push(field);
  }

  const flags = [];
  if (carriesUnredactedPageUrl(values.site, values.report)) flags.push("url-not-redacted");

  let severity = "normal";
  const addLabels = [];

  if (form.kind === "breakage") {
    if (values.surface && BREAKING_SURFACES.has(values.surface)) severity = "urgent";
    if (values.disabled === "Yes, turning it off fixes it") {
      addLabels.push("confirmed-ours");
    } else if (values.disabled === "No, it is broken either way") {
      severity = "normal";
      addLabels.push("not-ours");
    } else {
      flags.push("extension-off-test-not-run");
    }
  }

  if (form.kind === "false-positive") {
    if (values.severity && SEVERE_FALSE_POSITIVES.has(values.severity)) severity = "high";
  }

  if (form.kind === "missed-ad") {
    const report = values.report || "";
    const looksLikeReport = REPORT_HEADINGS.some((heading) => report.includes(heading));
    if (!looksLikeReport) {
      flags.push("no-inspector-report");
    } else if (report.includes("Safety blocks: none")) {
      // Nothing stopped the replacer, so the scanner simply did not score it.
      addLabels.push("scanner-miss");
    } else {
      addLabels.push("safety-block");
    }
    if (values.reproducible === "Only saw it once") flags.push("not-reproducible");
  }

  return {
    kind: form.kind,
    host: readHost(values.site),
    missing,
    severity,
    addLabels,
    flags,
    actionable: missing.length === 0
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = triage({
    title: process.env.ISSUE_TITLE || "",
    body: process.env.ISSUE_BODY || ""
  });
  console.log(JSON.stringify(result, null, 2));
}
