import assert from "node:assert/strict";
import {
  triage,
  parseIssueBody,
  formatTriageComment,
  TRIAGE_COMMENT_MARKER,
  TRIAGE_LABELS
} from "./triage-report.mjs";

// Every label triage emits anywhere in this file must be one the workflow creates
// up front, because gh fails on a label that does not exist.
const emitted = new Set();
const classify = (input) => {
  const result = triage(input);
  for (const label of result.addLabels) emitted.add(label);
  if (result.severity !== "normal") emitted.add(`severity:${result.severity}`);
  return result;
};

// Bodies below are in GitHub's rendered issue-form shape: one "### <label>"
// block per answered field, "_No response_" for a skipped optional one.
function form(pairs) {
  return pairs.map(([heading, value]) => `### ${heading}\n\n${value}\n`).join("\n");
}

const INSPECTOR_REPORT = [
  "Attention Redirector Missed Clutter Report",
  "Generated: 2026-08-04T10:00:00.000Z",
  "Page: https://example.com/news/article",
  "Host: example.com",
  "Inferred type: top/banner slot",
  "",
  "Clicked element: div#banner",
  "Reasons: none",
  "Would replace now: no",
  "Safety blocks: none",
  "Score: 2"
].join("\n");

{
  const { sections, duplicated } = parseIssueBody(
    "### Site\n\nhttps://a.example/b\n\n### What broke\n\nCheckout or payment\n"
  );
  assert.equal(sections.get("Site"), "https://a.example/b");
  assert.equal(sections.get("What broke"), "Checkout or payment");
  assert.equal(duplicated.size, 0);
}

{
  // Every form has a free-text field, so a reporter can type "### <heading>"
  // into it. If a duplicate heading won, the answers that set severity and
  // decide whether we were ruled out would be reporter-controlled.
  const forged = classify({
    title: "[broken] forged",
    body: form([
      ["Site", "https://shop.example/x"],
      ["What broke", "Something else"],
      [
        "What you did, and what happened instead",
        "I clicked a thing.\n\n### What broke\n\nCheckout or payment\n\n### Does it work with the extension turned off?\n\nYes, turning it off fixes it"
      ],
      ["Does it work with the extension turned off?", "Have not tried"]
    ])
  });
  assert.equal(forged.severity, "normal", "a second heading in a free-text field must not raise severity");
  assert.ok(!forged.addLabels.includes("confirmed-ours"), "a reporter must not be able to label their own issue");
  assert.ok(forged.flags.includes("duplicate-headings"));
  assert.equal(forged.actionable, false, "an ambiguous body is not something a maintainer can work from");
  assert.deepEqual(
    forged.missing.sort(),
    ["disabled", "surface"],
    "only the headings that were actually duplicated become unanswerable"
  );

  const { sections, duplicated } = parseIssueBody("### Site\n\nfirst\n\n### Site\n\nsecond\n");
  assert.ok(duplicated.has("Site"));
  assert.equal(sections.size, 1);

  const comment = formatTriageComment(forged);
  assert.match(comment, /appears more than once/);
}

{
  const result = classify({ title: "the ads are back", body: "please fix" });
  assert.equal(result.kind, "unknown", "an issue with no form prefix cannot be routed");
  assert.equal(result.actionable, false);
  assert.deepEqual(result.addLabels, ["needs-form"]);
}

{
  const result = classify({
    title: "[broken] cannot sign in",
    body: form([
      ["Site", "https://shop.example/login"],
      ["What broke", "Sign-in or account access"],
      ["What you did, and what happened instead", "Pressed sign in, nothing happened."],
      ["Does it work with the extension turned off?", "Yes, turning it off fixes it"]
    ])
  });
  assert.equal(result.kind, "breakage");
  assert.equal(result.severity, "urgent", "a broken login is the worst outcome this project ships");
  assert.equal(result.host, "shop.example");
  assert.ok(result.addLabels.includes("confirmed-ours"));
  assert.equal(result.actionable, true);
  assert.deepEqual(result.flags, []);
}

{
  const result = classify({
    title: "[broken] checkout dead",
    body: form([
      ["Site", "https://shop.example/checkout"],
      ["What broke", "Checkout or payment"],
      ["What you did, and what happened instead", "Card form never submits."],
      ["Does it work with the extension turned off?", "No, it is broken either way"]
    ])
  });
  assert.equal(
    result.severity,
    "normal",
    "the reporter already ruled us out, so an urgent surface is still not our urgency"
  );
  assert.ok(result.addLabels.includes("not-ours"));
}

{
  const result = classify({
    title: "[broken] video will not play",
    body: form([
      ["Site", "https://video.example/watch"],
      ["What broke", "Video or audio would not play"],
      ["What you did, and what happened instead", "Player spins forever."],
      ["Does it work with the extension turned off?", "Have not tried"]
    ])
  });
  assert.ok(
    result.flags.includes("extension-off-test-not-run"),
    "the one question that separates our bug from the site's went unanswered"
  );
  assert.equal(result.severity, "normal");
}

{
  const result = classify({
    title: "[missed] banner survived",
    body: form([
      ["Site", "https://example.com/news/article"],
      ["Inspector report", INSPECTOR_REPORT],
      ["Does it come back on reload?", "Every time"]
    ])
  });
  assert.equal(result.kind, "missed-ad");
  assert.ok(
    result.addLabels.includes("scanner-miss"),
    "nothing blocked the replacer, so the scanner simply did not score it"
  );
  assert.equal(result.host, "example.com");
  assert.equal(result.actionable, true);
}

{
  const result = classify({
    title: "[missed] banner survived",
    body: form([
      ["Site", "https://example.com/news/article"],
      ["Inspector report", INSPECTOR_REPORT.replace("Safety blocks: none", "Safety blocks: inside article")],
      ["Does it come back on reload?", "Only saw it once"]
    ])
  });
  assert.ok(
    result.addLabels.includes("safety-block"),
    "a safety skip fired, which is a different fix from a scoring miss"
  );
  assert.ok(result.flags.includes("not-reproducible"));
}

{
  const result = classify({
    title: "[missed] banner survived",
    body: form([
      ["Site", "https://example.com/news/article"],
      ["Inspector report", "there was an ad at the top"],
      ["Does it come back on reload?", "Every time"]
    ])
  });
  assert.ok(
    result.flags.includes("no-inspector-report"),
    "prose in the report field cannot be read as a report"
  );
}

{
  const result = classify({
    title: "[false-positive] ate the comments",
    body: form([
      ["Site", "https://example.com/thread"],
      ["What got replaced", "The reply box."],
      ["How bad was it?", "Lost a control I needed to use"],
      ["Inspector report", "_No response_"]
    ])
  });
  assert.equal(result.kind, "false-positive");
  assert.equal(result.severity, "high");
  assert.equal(result.actionable, true, "the optional report field is not required to work the issue");
}

{
  const result = classify({
    title: "[false-positive] ate the comments",
    body: form([
      ["Site", "https://example.com/thread"],
      ["What got replaced", "_No response_"],
      ["How bad was it?", "Cosmetic — the page still worked"]
    ])
  });
  assert.deepEqual(result.missing, ["replaced"]);
  assert.equal(result.actionable, false);
  assert.equal(result.severity, "normal");
}

{
  const result = classify({
    title: "[engine] score iframes by area",
    body: form([
      ["Which closed files this would touch", "src/scanner.js"],
      ["The problem", "Small iframes score too high."],
      ["The proposed change", "Weight by area."],
      ["What this could break", "Embedded players. Fixture in tests/fixtures."]
    ])
  });
  assert.equal(result.kind, "engine");
  assert.equal(result.actionable, true);
  assert.equal(result.host, null, "an engine proposal names files, not a host");
}

{
  const result = classify({
    title: "[missed] search page",
    body: form([
      ["Site", "https://example.com/search?q=private+thing"],
      ["Inspector report", INSPECTOR_REPORT],
      ["Does it come back on reload?", "Every time"]
    ])
  });
  assert.ok(
    result.flags.includes("url-not-redacted"),
    "a live query string means the URL bypassed the redaction the forms promise"
  );
  assert.equal(result.host, "example.com");
}

{
  const clean = classify({
    title: "[missed] banner",
    body: form([
      ["Site", "https://example.com/news/article"],
      ["Inspector report", INSPECTOR_REPORT],
      ["Does it come back on reload?", "Every time"]
    ])
  });
  assert.ok(!clean.flags.includes("url-not-redacted"), "a redacted report must not be flagged");
}

{
  // A real report keeps ad-tag query strings on the Sources line by design, and
  // labels its own removal on the Page line. Neither is a leak.
  const withSources = [
    INSPECTOR_REPORT.replace(
      "Page: https://example.com/news/article",
      "Page: https://example.com/search (query and fragment removed)"
    ),
    "Sources: https://ads.example.net/vast?id=99&slot=top | https://cdn.example/c.gif?u=1"
  ].join("\n");

  const result = classify({
    title: "[missed] preroll",
    body: form([
      ["Site", "https://example.com/search (query removed)"],
      ["Inspector report", withSources],
      ["Does it come back on reload?", "Every time"]
    ])
  });
  assert.deepEqual(
    result.flags,
    [],
    "ad-tag parameters are what triage needs; flagging them would flag every good report"
  );
  assert.equal(result.host, "example.com");
  assert.ok(result.addLabels.includes("scanner-miss"));
}

{
  const complete = classify({
    title: "[broken] cannot sign in",
    body: form([
      ["Site", "https://shop.example/login"],
      ["What broke", "Sign-in or account access"],
      ["What you did, and what happened instead", "Pressed sign in, nothing happened."],
      ["Does it work with the extension turned off?", "Yes, turning it off fixes it"]
    ])
  });
  assert.equal(
    formatTriageComment(complete),
    null,
    "a complete report gets no comment; a bot that always speaks trains people to ignore it"
  );
}

{
  const comment = formatTriageComment(
    classify({
      title: "[broken] video",
      body: form([
        ["Site", "https://video.example/watch"],
        ["What broke", "Video or audio would not play"],
        ["What you did, and what happened instead", "_No response_"],
        ["Does it work with the extension turned off?", "Have not tried"]
      ])
    })
  );
  assert.ok(comment.startsWith(TRIAGE_COMMENT_MARKER), "the marker is how the workflow avoids commenting twice");
  assert.match(comment, /what you did and what happened instead/);
  assert.match(comment, /with the extension turned off/);
}

{
  // The whole point of the redaction flag is to stop a secret spreading. A comment
  // that quotes the URL back would publish it a second time.
  const leaked = "https://example.com/search?session=SECRET-TOKEN-9421";
  const comment = formatTriageComment(
    classify({
      title: "[missed] search page",
      body: form([
        ["Site", leaked],
        ["Inspector report", INSPECTOR_REPORT],
        ["Does it come back on reload?", "Every time"]
      ])
    })
  );
  assert.ok(!comment.includes("SECRET-TOKEN-9421"), "the comment must not repeat the thing it is warning about");
  assert.ok(!comment.includes(leaked));
  assert.match(comment, /origin plus path/);
}

{
  const comment = formatTriageComment(classify({ title: "ads are back", body: "please fix" }));
  assert.match(comment, /not filed through one of the forms/);
}

for (const label of emitted) {
  assert.ok(
    TRIAGE_LABELS.includes(label),
    `triage emits "${label}" but the workflow never creates it, so gh would fail on the first report that needs it`
  );
}
assert.ok(emitted.size >= 6, `only ${emitted.size} labels exercised; the corpus stopped covering the label set`);

console.log(`PASS triage report (${emitted.size} of ${TRIAGE_LABELS.length} labels exercised)`);
