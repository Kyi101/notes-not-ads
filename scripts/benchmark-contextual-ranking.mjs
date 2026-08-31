import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(
  path.join(root, "src/contextual-ranking.js"),
  "utf8"
);
const context = vm.createContext({ URL });
vm.runInContext(
  `${source}\nthis.contextualRankingBenchmarkApi = { rankContextualNotes };`,
  context
);

const { rankContextualNotes } = context.contextualRankingBenchmarkApi;
const pageContext = {
  url: "https://travel.example/guides/berlin-by-train",
  title: "Plan a train trip from Kyiv to Berlin",
  headings: [
    "Compare sleeper trains and flight tickets",
    "Getting from the station to your hotel"
  ]
};
const notes = [
  "Book the Berlin train and choose a hotel near the station.",
  "Water the balcony plants this evening.",
  "Review the quarterly budget before Friday.",
  "Call Mum after lunch on Sunday.",
  "Finish the browser extension performance report."
];

for (let index = 0; index < 1000; index += 1) {
  rankContextualNotes(pageContext, notes);
}

const samples = [];
for (let index = 0; index < 5000; index += 1) {
  const started = performance.now();
  rankContextualNotes(pageContext, notes);
  samples.push(performance.now() - started);
}

samples.sort((left, right) => left - right);
const percentile = (value) =>
  samples[Math.min(samples.length - 1, Math.floor(samples.length * value))];
const average = samples.reduce((sum, sample) => sum + sample, 0) / samples.length;

console.log("Contextual ranking benchmark (5 notes, warm runtime)");
console.log(`mean: ${average.toFixed(4)} ms`);
console.log(`p95: ${percentile(0.95).toFixed(4)} ms`);
console.log(`p99: ${percentile(0.99).toFixed(4)} ms`);
