import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const ARRAY_START = /^\s*const DEFAULT_COSMETIC_FILTER_TEXT = \[\s*$/;
const ARRAY_END = /^\s*\]\.join\(/;
const STRING_LITERAL = /^\s*"(?:[^"\\]|\\.)*",?$/;

const target = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(projectRoot, "src/cosmetic-filters.js");
const label = path.relative(projectRoot, target) || target;

const lines = (await readFile(target, "utf8")).split("\n");

const startIndex = lines.findIndex((line) => ARRAY_START.test(line));
if (startIndex === -1) {
  throw new Error(
    `Cosmetic seed violation: ${label} has no "const DEFAULT_COSMETIC_FILTER_TEXT = [" line, so the seed list cannot be checked.`
  );
}

const endIndex = lines.findIndex((line, index) => index > startIndex && ARRAY_END.test(line));
if (endIndex === -1) {
  throw new Error(
    `Cosmetic seed violation: the seed array in ${label} is never closed with "].join(".`
  );
}

const entries = lines.slice(startIndex + 1, endIndex);
if (entries.length < 1) {
  throw new Error(`Cosmetic seed violation: the seed array in ${label} is empty.`);
}

entries.forEach((line, offset) => {
  if (STRING_LITERAL.test(line)) {
    return;
  }
  const lineNumber = startIndex + 2 + offset;
  throw new Error(
    [
      `Cosmetic seed violation: ${label}:${lineNumber} is not a plain double-quoted string literal.`,
      `  ${line.trim()}`,
      "Every seed entry must be a literal string. Backticks, ${...}, concatenation, and bare",
      "identifiers would let filter text become executable code in the shipped content script."
    ].join("\n")
  );
});

console.log(`PASS cosmetic seed lint (${entries.length} entries in ${label})`);
