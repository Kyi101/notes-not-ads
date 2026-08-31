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

console.log("Contextual ranking tests passed.");
