// The shape of a pasted report, and the promise made about what is in it.
//
// Three things have to agree or triage silently degrades: the formatter in
// src/inspector.js, the issue forms a reporter fills in, and the triage script
// that reads the result. This file is where they agree, and running it proves
// they still do.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

// Every labelled line a report can contain. Triage parses on these exact
// strings, so renaming one here without renaming it in src/inspector.js is the
// failure this list exists to catch.
export const REPORT_LABELS = [
  "Generated",
  "Page",
  "Title",
  "Reasons",
  "Would replace now",
  "Safety blocks",
  "Score",
  "Rect",
  "CSS",
  "Role/label",
  "Text",
  "Sources",
  "Ancestry",
  "Cards",
  "Viewport"
];

export const REPORT_HEADINGS = [
  "Notes Not Ads Inspector Report",
  "Notes Not Ads Missed Clutter Report",
  "Notes Not Ads Saved Inspector Reports",
  "Notes Not Ads Page Report"
];

// A form is only useful to triage if the fields it routes on are present. The
// field values here are the rendered headings, not the ids: GitHub posts a form
// response as "### <label>" blocks, so the label is what triage actually parses
// and the id is only how the form file names it.
export const ISSUE_FORMS = {
  "missed-ad.yml": {
    kind: "missed-ad",
    titlePrefix: "[missed] ",
    labels: ["missed-ad", "needs-triage"],
    fields: { site: "Site", report: "Inspector report", reproducible: "Does it come back on reload?" }
  },
  "false-positive.yml": {
    kind: "false-positive",
    titlePrefix: "[false-positive] ",
    labels: ["false-positive", "needs-triage"],
    fields: {
      site: "Site",
      replaced: "What got replaced",
      severity: "How bad was it?",
      report: "Report from the extension"
    },
    // The extension prefills this one, but a reporter who found the form
    // directly cannot, so its absence must not make the issue unactionable.
    optional: ["report"]
  },
  "broken-page.yml": {
    kind: "breakage",
    titlePrefix: "[broken] ",
    labels: ["breakage", "needs-triage", "priority"],
    fields: {
      site: "Site",
      surface: "What broke",
      steps: "What you did, and what happened instead",
      disabled: "Does it work with the extension turned off?"
    }
  },
  "engine-proposal.yml": {
    kind: "engine",
    titlePrefix: "[engine] ",
    labels: ["engine", "needs-triage"],
    fields: {
      files: "Which closed files this would touch",
      problem: "The problem",
      approach: "The proposed change",
      blast_radius: "What this could break"
    }
  }
};

const FIELD_TYPES = new Set(["markdown", "input", "textarea", "dropdown", "checkboxes"]);

const MAX_ISSUE_URL_LENGTH_EXPECTED = 7000;

// Runs popup.js the way the browser does, with just enough DOM for its top-level
// element lookups, and hands back the link builder. Same approach as
// scripts/test-page-gate.mjs: executing the shipped source is the only way the
// check cannot drift from it.
function loadPopupLinkBuilder(source) {
  const element = () => ({
    addEventListener() {},
    style: {},
    classList: { add() {}, remove() {} },
    appendChild() {},
    remove() {},
    select() {}
  });
  const documentStub = {
    getElementById: element,
    createElement: element,
    addEventListener() {},
    body: { appendChild() {} },
    documentElement: { dataset: {}, style: {} },
    execCommand() {}
  };

  const factory = new Function(
    "document",
    "chrome",
    "navigator",
    "window",
    `${source}\nreturn { buildFalsePositiveIssueUrl, setDomain: (value) => { activeDomain = value; } };`
  );

  return factory(
    documentStub,
    { runtime: {}, storage: { local: {} }, tabs: {} },
    {},
    { matchMedia: () => ({ matches: false, addEventListener() {} }) }
  );
}

function fail(message) {
  throw new Error(`Report contract violation: ${message}`);
}

// Loads src/shared.js the way the browser does — wrapped in a function, because
// it opens with a top-level return that only a wrapper makes legal. mergeSettings
// lives in src/main.js and is stubbed; nothing under test touches settings.
async function loadShared() {
  const source = await readFile(path.join(projectRoot, "src/shared.js"), "utf8");
  const factory = new Function(
    "window",
    "mergeSettings",
    `${source}\nreturn { formatReportUrl, REPORT_URL_WITHHELD };`
  );
  return factory({}, () => ({}));
}

async function main() {
  const { formatReportUrl, REPORT_URL_WITHHELD } = await loadShared();

  // The privacy promise in CONTRIBUTING.md, executed rather than asserted in prose.
  const urlCases = [
    ["https://example.com/news/article", "https://example.com/news/article", "plain URL survives whole"],
    [
      "https://example.com/search?q=my+medical+question",
      "https://example.com/search (query removed)",
      "a query string never reaches the clipboard"
    ],
    [
      "https://example.com/doc#section-4",
      "https://example.com/doc (fragment removed)",
      "a fragment never reaches the clipboard"
    ],
    [
      "https://mail.example.com/inbox?token=abc123#msg",
      "https://mail.example.com/inbox (query and fragment removed)",
      "both are named when both are dropped"
    ],
    ["https://example.com", "https://example.com/", "a bare origin keeps its slash"],
    ["not a url", REPORT_URL_WITHHELD, "an unparseable URL is withheld, not passed through"]
  ];

  for (const [input, expected, why] of urlCases) {
    const actual = formatReportUrl(input);
    if (actual !== expected) {
      fail(`formatReportUrl(${JSON.stringify(input)}) returned ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)} — ${why}.`);
    }
  }

  // A token that looks harmless in a test can still be leaked by a rewrite that
  // stops calling the helper, so check the shipped bundle too.
  const bundle = await readFile(path.join(projectRoot, "src/content.js"), "utf8");
  for (const match of bundle.matchAll(/`(Page|Host): \$\{([^}]+)\}`/g)) {
    if (match[2].includes("location.href") && !match[2].includes("formatReportUrl")) {
      fail(
        `src/content.js writes the raw page URL into a report line (${match[0]}). CONTRIBUTING.md promises origin plus path; route it through formatReportUrl.`
      );
    }
  }

  const inspector = await readFile(path.join(projectRoot, "src/inspector.js"), "utf8");
  for (const label of REPORT_LABELS) {
    if (!inspector.includes(`${label}: `)) {
      fail(`src/inspector.js emits no "${label}: " line, but triage parses on it.`);
    }
  }
  // Headings are checked against the built bundle rather than one partial,
  // because a heading may be a literal in src/inspector.js or a constant in
  // src/shared.js. The bundle is what ships and holds both.
  for (const heading of REPORT_HEADINGS) {
    if (!bundle.includes(heading)) {
      fail(`the content bundle no longer emits the heading "${heading}", which is how a paste is recognised as a report. Run npm run build if you only edited a partial.`);
    }
  }

  // A minimal structural read of a GitHub issue form. Not a YAML parser — it only
  // needs the keys triage routes on, and a wrong key here is silently ignored by
  // GitHub rather than rejected, which is exactly why it needs a local check.
  function readForm(text, file) {
    const labels = [];
    const fields = new Map();
    let inBody = false;
    let currentType = null;
    let currentId = null;

    for (const raw of text.split("\n")) {
      const labelLine = raw.match(/^labels:\s*\[(.+)\]\s*$/);
      if (labelLine) {
        for (const value of labelLine[1].split(",")) labels.push(value.trim().replace(/^["']|["']$/g, ""));
        continue;
      }
      if (/^body:\s*$/.test(raw)) {
        inBody = true;
        continue;
      }
      if (!inBody) continue;

      const typeLine = raw.match(/^\s*-\s*type:\s*(\S+)\s*$/);
      if (typeLine) {
        currentType = typeLine[1];
        currentId = null;
        if (!FIELD_TYPES.has(currentType)) fail(`${file} declares an unknown field type "${currentType}".`);
        continue;
      }
      const idLine = raw.match(/^\s*id:\s*(\S+)\s*$/);
      if (idLine) {
        if (currentType === "markdown") fail(`${file} gives an id to a markdown block, which GitHub ignores.`);
        currentId = idLine[1];
        fields.set(currentId, null);
        continue;
      }
      const headingLine = raw.match(/^\s*label:\s*(.+?)\s*$/);
      if (headingLine && currentId) {
        fields.set(currentId, headingLine[1].replace(/^["']|["']$/g, ""));
      }
    }

    if (!inBody) fail(`${file} has no body: section, so GitHub renders it as a blank issue.`);
    return { labels, fields };
  }

  const templateDir = path.join(projectRoot, ".github/ISSUE_TEMPLATE");
  for (const [file, expected] of Object.entries(ISSUE_FORMS)) {
    let text;
    try {
      text = await readFile(path.join(templateDir, file), "utf8");
    } catch (error) {
      fail(`.github/ISSUE_TEMPLATE/${file} is missing, so the reports triage expects cannot be filed.`);
    }

    if (!/^name:\s*\S/m.test(text)) fail(`${file} has no name:, so it does not appear in the issue chooser.`);
    if (!/^description:\s*\S/m.test(text)) fail(`${file} has no description:.`);

    // The title prefix is how triage tells one form's issues from another's.
    if (!text.includes(`title: "${expected.titlePrefix}"`)) {
      fail(`${file} must set title: "${expected.titlePrefix}", which is the only thing distinguishing its issues from another form's.`);
    }

    const form = readForm(text, file);
    for (const label of expected.labels) {
      if (!form.labels.includes(label)) {
        fail(`${file} does not apply the "${label}" label, which is how triage finds it.`);
      }
    }
    for (const [field, heading] of Object.entries(expected.fields)) {
      if (!form.fields.has(field)) {
        fail(`${file} has no field with id "${field}", which triage reads.`);
      }
      if (form.fields.get(field) !== heading) {
        fail(
          `${file} labels the "${field}" field "${form.fields.get(field)}", but triage parses the rendered body for "### ${heading}". A relabelled field is invisible to triage.`
        );
      }
    }
  }

  const config = await readFile(path.join(templateDir, "config.yml"), "utf8");
  if (!/^blank_issues_enabled:\s*false\s*$/m.test(config)) {
    fail("config.yml must set blank_issues_enabled: false. A blank issue skips every question triage depends on.");
  }
  if (!config.includes("/security/advisories/new")) {
    fail("config.yml must offer private vulnerability reporting, or the first exploitable bug arrives as a public issue.");
  }

  // The popup builds the prefilled issue link and the content script defines the
  // same constants; they are separate scripts and neither imports the other, so
  // a repository rename in one copy would quietly send reporters somewhere else.
  const popupSource = await readFile(path.join(projectRoot, "popup.js"), "utf8");
  const sharedSource = await readFile(path.join(projectRoot, "src/shared.js"), "utf8");
  for (const constant of ["ISSUE_FORM_BASE_URL", "MAX_ISSUE_URL_LENGTH"]) {
    const pattern = new RegExp(`const ${constant} =\\s*([^;]+);`);
    const inPopup = popupSource.match(pattern);
    const inShared = sharedSource.match(pattern);
    if (!inPopup) fail(`popup.js no longer defines ${constant}, which builds the prefilled issue link.`);
    if (!inShared) fail(`src/shared.js no longer defines ${constant}.`);
    if (inPopup[1].replace(/\s+/g, "") !== inShared[1].replace(/\s+/g, "")) {
      fail(`${constant} differs between popup.js and src/shared.js. The two copies decide where a reporter is sent, so they have to agree.`);
    }
  }

  // The classic silent break: a renamed id in one file and not the other leaves
  // getElementById returning null, the listener never bound, and a button that
  // looks right and does nothing.
  const popupMarkup = await readFile(path.join(projectRoot, "popup.html"), "utf8");
  for (const id of ["reportFalsePositive", "reportMissedAd"]) {
    if (!popupMarkup.includes(`id="${id}"`)) {
      fail(`popup.html has no element with id "${id}", but popup.js binds a listener to it.`);
    }
    if (!popupSource.includes(`"${id}"`)) {
      fail(`popup.js never looks up "${id}", so the button in popup.html does nothing.`);
    }
  }

  // The form the popup prefills has to be the form that exists.
  if (!popupSource.includes('template: "false-positive.yml"')) {
    fail("popup.js does not name false-positive.yml as the prefill template, so the link opens a blank chooser.");
  }

  // The link is built by running popup.js, not by reading it. A prefilled issue
  // that silently drops a field looks fine in review and arrives empty, and the
  // trimming path in particular only runs on a report too long to ever appear in
  // a hand-written test.
  const popup = loadPopupLinkBuilder(popupSource);
  popup.setDomain("www.olx.ua");

  const shortReport = [
    "Notes Not Ads Page Report",
    "Page: https://www.olx.ua/d/uk/obyavlenie/telefon",
    "Cards: 15"
  ].join("\n");
  const shortLink = new URL(popup.buildFalsePositiveIssueUrl(shortReport));

  if (shortLink.searchParams.get("template") !== "false-positive.yml") {
    fail("the prefilled link does not name false-positive.yml, so it opens a blank issue chooser.");
  }
  if (shortLink.searchParams.get("site") !== "https://www.olx.ua/d/uk/obyavlenie/telefon") {
    fail(`the prefilled link put ${JSON.stringify(shortLink.searchParams.get("site"))} in the site field; it should carry the report's Page line.`);
  }
  if (shortLink.searchParams.get("report") !== shortReport) {
    fail("the prefilled link did not round-trip the report body.");
  }
  if (!shortLink.searchParams.get("title").startsWith("[false-positive] ")) {
    fail("the prefilled link's title lacks the prefix triage routes on.");
  }
  for (const blank of ["replaced", "severity"]) {
    if (shortLink.searchParams.has(blank)) {
      fail(`the prefilled link fills in "${blank}". That answer is the reporter's to give, not ours to put in their mouth.`);
    }
  }

  const longReport = `${shortReport}\n${"9x  ad-like identifier  |  div.filler  |  300x250\n".repeat(600)}`;
  const longLink = popup.buildFalsePositiveIssueUrl(longReport);
  if (longLink.length > MAX_ISSUE_URL_LENGTH_EXPECTED) {
    fail(`an oversized report produced a ${longLink.length}-character link; GitHub and the browser both stop honouring one past about 8k, and the failure is silent.`);
  }
  const trimmedBody = new URL(longLink).searchParams.get("report");
  if (!trimmedBody.includes("full report is on your clipboard")) {
    fail("a trimmed report does not say it was trimmed, so it reads as the whole picture.");
  }
  if (!trimmedBody.startsWith("Notes Not Ads Page Report")) {
    fail("trimming ate the heading, so the paste is no longer recognisable as a report.");
  }

  const contributing = await readFile(path.join(projectRoot, "CONTRIBUTING.md"), "utf8");
  if (!contributing.includes("origin plus path")) {
    fail("CONTRIBUTING.md no longer states what happens to the page URL. The promise and the code have to move together.");
  }

  console.log(
    `PASS report contract (${urlCases.length} URL cases, ${REPORT_LABELS.length} report labels, ${Object.keys(ISSUE_FORMS).length} issue forms, prefilled link built and trimmed)`
  );
}

// The constants above are exported so the triage script shares one definition of
// the report's shape. The checks only run on direct execution, so importing them
// cannot fail triage on unrelated governance drift.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
