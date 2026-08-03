import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const ARRAY_START = /^\s*const DEFAULT_COSMETIC_FILTER_TEXT = \[\s*$/;
const ARRAY_TERMINATOR = /^\s*\]\.join\("\\n"\);\s*$/;
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

const entries = [];
let endIndex = -1;

for (let index = startIndex + 1; index < lines.length; index += 1) {
  const line = lines[index];

  if (ARRAY_TERMINATOR.test(line)) {
    endIndex = index;
    break;
  }

  if (!STRING_LITERAL.test(line)) {
    throw new Error(
      [
        `Cosmetic seed violation: ${label}:${index + 1} is neither a plain double-quoted string literal nor the array terminator.`,
        `  ${line.trim()}`,
        "Every seed entry must be a literal string. Backticks, ${...}, concatenation, and bare",
        "identifiers would let filter text become executable code in the shipped content script."
      ].join("\n")
    );
  }

  entries.push(line);
}

if (endIndex === -1) {
  throw new Error(
    `Cosmetic seed violation: the seed array in ${label} is never closed with '].join("\\n");'.`
  );
}

if (entries.length < 1) {
  throw new Error(`Cosmetic seed violation: the seed array in ${label} is empty.`);
}

console.log(`PASS cosmetic seed lint (${entries.length} entries in ${label})`);
