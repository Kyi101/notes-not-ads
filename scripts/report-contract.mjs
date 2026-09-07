// The shape of a pasted report, and the promise made about what is in it.
//
// Three things have to agree or triage silently degrades: the formatter in
// src/inspector.js, the issue forms a reporter fills in, and the triage script
// that reads the result. This file is where they agree, and running it proves
// they still do.

import { readFile } from "node:fs/promises";
import vm from "node:vm";
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

// Exported on its own as well as in the list below: triage routes on this one
// specifically, and a second copy of the string there is a second thing to
// forget when it changes.
export const PAGE_REPORT_HEADING = "Notes Not Ads Page Report";

export const REPORT_HEADINGS = [
  "Notes Not Ads Inspector Report",
  "Notes Not Ads Missed Clutter Report",
  "Notes Not Ads Saved Inspector Reports",
  PAGE_REPORT_HEADING
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
    // The extension puts this on the clipboard to paste, but a reporter who
    // found the form directly has none, so its absence must not make the
    // issue unactionable.
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


// Runs the shipped content modules and hands back the two link builders. Same
// approach as scripts/test-page-gate.mjs, and for the same reason: executing the
// real source is the only way this cannot drift from it. The bundle itself is an
// IIFE that ends in init(), so the partials are wrapped here instead.
async function loadIssueBuilders(manifest) {
  const MODULES = ["shared", "main", "inspector", "scanner", "replacer"];
  const body = (
    await Promise.all(
      MODULES.map((name) => readFile(path.join(projectRoot, `src/${name}.js`), "utf8"))
    )
  ).join("\n");

  const sandbox = {
    location: {
      hostname: "www.olx.ua",
      pathname: "/d/uk/obyavlenie/telefon",
      href: "https://www.olx.ua/d/uk/obyavlenie/telefon"
    },
    document: { body: null, title: "", querySelectorAll: () => [] },
    // The real manifest, not a stub: the issue URL is derived from
    // homepage_url now, so a stubbed one would test the stub.
    chrome: {
      runtime: { getManifest: () => manifest },
      storage: { local: {} }
    },
    console,
    // The vm context is not the browser realm, so the web globals the builder
    // uses have to be handed in explicitly.
    URLSearchParams,
    URL,
    __out: {}
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const source = [
    "function __builders(){",
    body,
    "__out.falsePositiveIssueUrl = falsePositiveIssueUrl;",
    "__out.missedAdIssueUrl = missedAdIssueUrl;",
    "}",
    "__builders();"
  ].join("\n");

  vm.runInContext(source, vm.createContext(sandbox));
  return sandbox.__out;
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

  // The popup no longer builds the link — src/main.js hands it one, so there is a
  // single builder. What the popup must still do is use it.
  const popupSource = await readFile(path.join(projectRoot, "popup.js"), "utf8");
  if (!popupSource.includes("response.issueUrl")) {
    fail("popup.js no longer opens the issueUrl handed back by AR_PAGE_REPORT, so its report button leads nowhere.");
  }
  if (/const ISSUE_FORM_BASE_URL/.test(popupSource)) {
    fail("popup.js has grown its own copy of the issue URL again. One builder, in src/shared.js.");
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

  // The links are built by running the shipped code, not by reading it. A
  // prefilled issue that silently drops a field looks fine in review and arrives
  // empty, and the trimming path only runs on a report too long to write by hand.
  const runtimeManifest = JSON.parse(
    await readFile(path.join(projectRoot, "manifest.json"), "utf8")
  );
  const builders = await loadIssueBuilders(runtimeManifest);
  const expectedBase = `${runtimeManifest.homepage_url.replace(/\/+$/, "")}/issues/new`;

  // The links are built by running the shipped code, not by reading it, and
  // what is asserted is an absence.
  //
  // Query parameters travel in the GET request, so anything prefilled here
  // reaches GitHub the moment the tab opens — before the reporter has read it
  // or pressed Submit. An earlier version prefilled the site and the whole
  // report, which made "nothing is ever sent" false while reading like a
  // convenience. The link may name a form and nothing else; the report travels
  // on the clipboard, where the reporter decides what happens to it.
  for (const [builder, template] of [
    ["falsePositiveIssueUrl", "false-positive.yml"],
    ["missedAdIssueUrl", "missed-ad.yml"]
  ]) {
    const link = new URL(builders[builder]());

    if (`${link.origin}${link.pathname}` !== expectedBase) {
      fail(`${builder} points at ${link.origin}${link.pathname}, but the manifest's homepage_url makes the issue form ${expectedBase}.`);
    }
    if (link.searchParams.get("template") !== template) {
      fail(`${builder} does not name ${template}, so the link opens a blank issue chooser.`);
    }

    const carried = [...link.searchParams.keys()].filter((key) => key !== "template");
    if (carried.length) {
      fail(
        `${builder} puts ${carried.join(", ")} in the query string. Those reach GitHub when the tab opens, before the reporter submits anything, which is exactly what "nothing is ever sent" cannot mean.`
      );
    }
  }

  // The same absence against the shipped bundle, so a builder that starts
  // concatenating page data onto the URL by some other route is caught too.
  if (/issues\/new[^"'`\n]*[?&](report|site|title|body)=/.test(bundle)) {
    fail("the content bundle builds an issue URL carrying report, site, title or body. Those reach GitHub on tab open.");
  }

  // The worker is the only thing that can open a tab, and it must refuse
  // anything that is not the issue form.
  const background = await readFile(path.join(projectRoot, "src/background.js"), "utf8");

  // The worker validates the URL it is asked to open and the content script
  // builds it. They cannot import each other, so both derive from the manifest;
  // a literal reintroduced in either is the half-done rename this guards.
  const sharedSource = await readFile(path.join(projectRoot, "src/shared.js"), "utf8");
  for (const [name, source] of [
    ["src/background.js", background],
    ["src/shared.js", sharedSource]
  ]) {
    if (/https:\/\/github\.com\/[^"'`\s]*\/issues\/new/.test(source)) {
      fail(`${name} hardcodes the issue-form URL. Derive it from the manifest's homepage_url, which is the one place a repository rename already has to touch.`);
    }
    if (!source.includes("getManifest")) {
      fail(`${name} no longer derives the issue-form URL from the manifest.`);
    }
  }

  if (!background.includes("AR_OPEN_ISSUE")) {
    fail("src/background.js does not handle AR_OPEN_ISSUE, so the missed-ad report cannot open the issue form.");
  }
  if (!background.includes("refused: not the issue form")) {
    fail("src/background.js opens whatever URL it is handed. Keep the check that it is the issue form.");
  }

  const contributing = await readFile(path.join(projectRoot, "CONTRIBUTING.md"), "utf8");
  if (!contributing.includes("origin plus path")) {
    fail("CONTRIBUTING.md no longer states what happens to the page URL. The promise and the code have to move together.");
  }

  console.log(
    `PASS report contract (${urlCases.length} URL cases, ${REPORT_LABELS.length} report labels, ${Object.keys(ISSUE_FORMS).length} issue forms, links carry no page data)`
  );
}

// The constants above are exported so the triage script shares one definition of
// the report's shape. The checks only run on direct execution, so importing them
// cannot fail triage on unrelated governance drift.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
