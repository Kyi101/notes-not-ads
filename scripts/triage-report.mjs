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
// A rendered body is ambiguous by construction: every form has a free-text
// field, and "### What broke" typed into one is indistinguishable from the
// heading the form emitted. Position does not settle it either — a forged
// heading sits between two genuine ones. So a heading that appears twice is
// reported as ambiguous rather than resolved, and triage declines to route on
// it. Guessing here would let a reporter set their own severity and labels.
export function parseIssueBody(body) {
  const sections = new Map();
  const duplicated = new Set();
  const parts = body.split(/^###[ \t]+(.+?)[ \t]*$/m);

  for (let index = 1; index < parts.length; index += 2) {
    const heading = parts[index].trim();
    if (sections.has(heading)) {
      duplicated.add(heading);
      continue;
    }
    sections.set(heading, parts[index + 1].trim());
  }

  return { sections, duplicated };
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

  const { sections, duplicated } = parseIssueBody(body);
  const values = {};
  const missing = [];
  const flags = [];

  for (const [field, heading] of Object.entries(form.fields)) {
    const value = duplicated.has(heading) ? null : sections.get(heading);
    values[field] = answered(value) ? value : null;
    if (!answered(value)) missing.push(field);
  }

  if (duplicated.size) flags.push("duplicate-headings");
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

export const TRIAGE_COMMENT_MARKER = "<!-- attention-redirector-triage -->";

// Every label this system can ever apply, forms included. The workflow creates
// them idempotently before it labels anything: gh fails on a label that does not
// exist yet, and the first real report is a bad time to discover that.
export const TRIAGE_LABELS = [
  ...new Set([
    ...FORMS.flatMap((form) => form.labels),
    "needs-form",
    "confirmed-ours",
    "not-ours",
    "scanner-miss",
    "safety-block",
    "severity:urgent",
    "severity:high"
  ])
];

const FIELD_PROMPTS = {
  site: "the site, as origin plus path",
  report: "the inspector report, copied from the extension popup",
  reproducible: "whether it comes back on reload",
  replaced: "what was in that spot before the card appeared",
  severity: "how bad it was",
  surface: "what broke",
  steps: "what you did and what happened instead",
  disabled: "whether it works with the extension turned off",
  files: "which closed files this would touch",
  problem: "what goes wrong today",
  approach: "the proposed change",
  blast_radius: "what this could break"
};

// Says only what the classifier established. Never quotes the issue back: a body
// flagged for carrying a query string is the last thing to repeat in a comment
// that cannot be unpublished.
export function formatTriageComment(result) {
  const asks = [];

  for (const field of result.missing) {
    asks.push(`- Missing: ${FIELD_PROMPTS[field] || field}.`);
  }
  if (result.flags.includes("extension-off-test-not-run")) {
    asks.push(
      "- Please try the page with the extension turned off. That one answer decides whether this is our bug or the site's, and nothing else in the report can settle it."
    );
  }
  if (result.flags.includes("no-inspector-report")) {
    asks.push(
      "- The report field does not contain an inspector report. Open the extension popup, press **Report missed ad**, click the ad, and paste what lands on your clipboard."
    );
  }
  if (result.flags.includes("url-not-redacted")) {
    asks.push(
      "- The page URL still carries a query string or fragment. Please edit the issue and cut it back to origin plus path — a query string can carry a session token, and an edit does not remove it from the issue's history."
    );
  }
  if (result.flags.includes("duplicate-headings")) {
    asks.push(
      "- One of the form's headings appears more than once, so it is not possible to tell which answer is the form's and which was typed into a text box. Please edit the issue and change the extra `###` lines to plain text."
    );
  }
  if (result.kind === "unknown") {
    asks.push(
      "- This issue was not filed through one of the forms, so there is nothing to route on. Please open a new one from the issue chooser."
    );
  }

  if (!asks.length) return null;

  return [
    TRIAGE_COMMENT_MARKER,
    "Automated first pass. Nothing here is a judgement about the report — these are the answers that are missing before it can be worked.",
    "",
    ...asks
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--labels")) {
    console.log(TRIAGE_LABELS.join("\n"));
    process.exit(0);
  }

  const result = triage({
    title: process.env.ISSUE_TITLE || "",
    body: process.env.ISSUE_BODY || ""
  });

  if (process.argv.includes("--comment")) {
    const comment = formatTriageComment(result);
    if (comment) console.log(comment);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}
