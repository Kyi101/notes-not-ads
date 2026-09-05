import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(
  path.join(root, "src/contextual-ranking.js"),
  "utf8"
);
const context = vm.createContext({ URL });
vm.runInContext(source, context);

assert.ok(
  context.NotesNotAdsContextualRanking,
  "The ranker must expose a stable public namespace."
);
const { rankContextualNotes } = context.NotesNotAdsContextualRanking;

const travelPage = {
  url: "https://travel.example/flights/kyiv-berlin",
  title: "Flights from Kyiv to Berlin",
  headings: ["Compare tickets for your Berlin trip"]
};
const travelNotes = [
  "Water the balcony plants this evening.",
  "Book Berlin flights and check the train from the airport.",
  "Review the quarterly budget before Friday."
];

const travelRanking = rankContextualNotes(travelPage, travelNotes);
assert.equal(travelRanking[0].note, travelNotes[1]);
assert.ok(travelRanking[0].score > travelRanking[1].score);
assert.equal(travelRanking[0].confidence, "strong");
assert.ok(
  travelRanking[0].reasons.some((reason) => reason.includes("berlin")),
  `Expected an explainable Berlin match: ${JSON.stringify(travelRanking[0])}`
);

const financePage = {
  url: "https://finance.example/markets",
  title: "Quarterly markets and company earnings",
  headings: ["Revenue outlook"]
};
const financeNotes = [
  "Review the quarterly budget before Friday.",
  "Book Berlin flights and check the train from the airport."
];
const financeRanking = rankContextualNotes(financePage, financeNotes);
assert.equal(financeRanking[0].note, financeNotes[0]);

const noSignalRanking = rankContextualNotes(
  {
    url: "https://example.com/",
    title: "Welcome",
    headings: []
  },
  travelNotes
);
assert.equal(noSignalRanking[0].score, 0);
assert.deepEqual(
  Array.from(noSignalRanking, (result) => result.note),
  travelNotes,
  "A no-signal page preserves the stable note order for the rotation fallback."
);

const weakRanking = rankContextualNotes(
  {
    url: "https://example.com/",
    title: "Home",
    headings: []
  },
  ["Call home tonight.", "Water the plants."]
);
assert.equal(weakRanking[0].confidence, "weak");
assert.equal(weakRanking[1].confidence, "none");

assert.equal(rankContextualNotes({ title: "КИЇВ — ПОДОРОЖ!" }, [
  "Полити рослини", "Подорож до Київ"
])[0].note, "Подорож до Київ");
assert.equal(rankContextualNotes({ url: "https://example.org/подорож/київ" }, [
  "Полити рослини", "Подорож Київ"
])[0].confidence, "strong", "Unicode URL paths must be decoded before matching.");
assert.deepEqual(Array.from(rankContextualNotes({ title: "Berlin" }, [
  "Berlin trip", "Berlin trip"
]), (item) => item.note), ["Berlin trip", "Berlin trip"]);
assert.equal(rankContextualNotes({ title: "x ".repeat(1000) + "Berlin" }, [
  "Berlin trip"
])[0].confidence, "none", "Page fields must have a bounded text budget.");
assert.deepEqual(Array.from(rankContextualNotes({ title: "Berlin" }, [
  "Berlin train", "Berlin plane"
]), (item) => item.note), ["Berlin train", "Berlin plane"], "Equal scores retain input order.");
assert.doesNotThrow(() => rankContextualNotes({ url: "https://example.org/%E0%A4%A" }, travelNotes));
assert.equal(rankContextualNotes({ headings: ["Welcome", "Berlin flights"] }, travelNotes)[0].score, 0,
  "Later headings must not contaminate the first-heading context.");
assert.equal(rankContextualNotes({ title: "Berlin ".repeat(20) }, travelNotes)[0].score,
  rankContextualNotes({ title: "Berlin" }, travelNotes)[0].score,
  "Repeating a page keyword must not amplify its field weight.");

// Exercise the actual selector with a small DOM boundary, not a copy of it.
vm.runInContext(fs.readFileSync(path.join(root, "src/replacer.js"), "utf8"), context);
vm.runInContext(`
  var state = {
    settings: { noteSelectionMode: "contextual", anchorNotes: ["Water plants", "Book Berlin flights", "Call home"] },
    noteCursor: null, contextualNoteCursor: 0
  };
  var location = { href: "https://example.org/", hostname: "example.org", pathname: "/" };
  var headingReads = 0;
  var document = { title: "Berlin flights", querySelector: () => { headingReads += 1; return null; } };
  var slots = [];
  var isDomReplacementAllowed = () => true;
  var HTMLElement = class {};
  var queryAllScanRoots = () => slots;
  renderReplacementSlot = (slot, selection) => { slot.note = selectAnchorNote(slot, selection); };
`, context);
assert.deepEqual(Array.from(vm.runInContext("getSelectableAnchorNotes().notes", context)), [
  "Book Berlin flights", "Water plants", "Call home"
], "Strong notes lead; other user notes must remain in the rotation.");
vm.runInContext(`
  slots = Array.from({ length: 2 }, () => Object.assign(new HTMLElement(), {
    dataset: {}, getBoundingClientRect: () => ({ top: 0 })
  }));
  headingReads = 0;
  renderInReadingOrder(slots);
  applySettingsToReplacedSlots();
`, context);
assert.equal(vm.runInContext("headingReads", context), 2, "Read context once per render batch.");
vm.runInContext(`
  var nextSlot = { dataset: {} };
  selectAnchorNote(nextSlot);
`, context);
assert.equal(vm.runInContext("nextSlot.dataset.attentionRedirectorNote", context), "2",
  "Settings refresh must not rewind the cursor for newly arriving cards.");
vm.runInContext('state.settings.anchorNotes = ["Call home", "Water plants"]; document.title = "Home";', context);
assert.equal(vm.runInContext("getSelectableAnchorNotes().contextual", context), false,
  "Weak matches use the rotation fallback.");

console.log("Contextual ranking tests passed.");
