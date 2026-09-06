import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const linter = path.join(__dirname, "lint-cosmetic-seed.mjs");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "attention-redirector-cosmetic-lint-"));

function seedSource(entries, eol = "\n") {
  return [
    "(() => {",
    "  const DEFAULT_COSMETIC_FILTER_TEXT = [",
    ...entries.map((entry) => `    ${entry}`),
    '  ].join("\\n");',
    "",
    "  function domainMatchesHost(domain, hostname) {",
    "    return hostname === domain || hostname.endsWith(`.${domain}`);",
    "  }",
    "",
    "  globalThis.seed = { DEFAULT_COSMETIC_FILTER_TEXT, domainMatchesHost };",
    "})();"
  ].join(eol);
}

async function lint(name, entries, eol = "\n") {
  const file = path.join(tempDir, `${name}.js`);
  await writeFile(file, seedSource(entries, eol), "utf8");
  try {
    await run(process.execPath, [linter, file]);
    return null;
  } catch (error) {
    return String(error.stderr || error.message);
  }
}

const CLEAN_ENTRIES = [
  '"",',
  '"! a comment line",',
  '"##.adsbygoogle",',
  '"##[aria-label=\\"Advertisement\\"]",',
  '""'
];

try {
  const cleanResult = await lint("clean", CLEAN_ENTRIES);
  if (cleanResult !== null) {
    throw new Error(`A clean seed array must pass, but the lint failed with: ${cleanResult}`);
  }

  const hostile = [
    ["backtick", "`##.ad-${host}`,"],
    ["concatenation", '"##.ad-" + host + ",",'],
    ["identifier", "upstreamLine,"],
    ["single-quoted", "'##.ad-slot',"]
  ];

  for (const [name, entry] of hostile) {
    const failure = await lint(name, ['"##.adsbygoogle",', entry, '""']);
    if (failure === null) {
      throw new Error(`A ${name} seed entry must be rejected, but the lint passed.`);
    }
    if (!failure.includes("Cosmetic seed violation")) {
      throw new Error(`The ${name} rejection did not explain itself: ${failure}`);
    }
  }

  const missingArray = path.join(tempDir, "missing.js");
  await writeFile(missingArray, "(() => {})();\n", "utf8");
  try {
    await run(process.execPath, [linter, missingArray]);
    throw new Error("A file with no seed array must be rejected, but the lint passed.");
  } catch (error) {
    if (!String(error.stderr || error.message).includes("Cosmetic seed violation")) {
      throw error;
    }
  }

  const bypass = await lint("bypass", [
    '"##.adsbygoogle",',
    '].join("\\n") + [',
    "`##.ad-${host}`,"
  ]);
  if (bypass === null) {
    throw new Error("A line that imitates the array terminator must be rejected, but the lint passed.");
  }
  if (!bypass.includes("Cosmetic seed violation")) {
    throw new Error(`The terminator-bypass rejection did not explain itself: ${bypass}`);
  }

  const empty = await lint("empty", []);
  if (empty === null || !empty.includes("is empty")) {
    throw new Error(`An empty seed array must be rejected as empty, got: ${empty}`);
  }

  const unclosed = path.join(tempDir, "unclosed.js");
  await writeFile(
    unclosed,
    '(() => {\n  const DEFAULT_COSMETIC_FILTER_TEXT = [\n    "##.adsbygoogle",',
    "utf8"
  );
  try {
    await run(process.execPath, [linter, unclosed]);
    throw new Error("An unclosed seed array must be rejected, but the lint passed.");
  } catch (error) {
    if (!String(error.stderr || error.message).includes("never closed")) {
      throw error;
    }
  }

  // A Windows checkout with core.autocrlf=true hands every line back with a
  // trailing \r, which the raw-line patterns rejected — so the pre-PR command
  // CONTRIBUTING requires failed on line 3 of a clean checkout and no Windows
  // contributor could run it. Reported as #6.
  //
  // The corpus runs twice on purpose. Accepting CRLF is only half of it: the
  // point of this lint is that upstream filter text cannot become executable
  // code, so every hostile entry has to stay rejected under both endings.
  // A normalization that quietly widened what parses would be a worse bug than
  // the one it fixed.
  const crlfClean = await lint("clean-crlf", CLEAN_ENTRIES, "\r\n");
  if (crlfClean !== null) {
    throw new Error(`A clean seed array with CRLF endings must pass, but the lint failed with: ${crlfClean}`);
  }

  for (const [name, entry] of hostile) {
    const failure = await lint(`${name}-crlf`, ['"##.adsbygoogle",', entry, '""'], "\r\n");
    if (failure === null) {
      throw new Error(`A ${name} seed entry must be rejected under CRLF too, but the lint passed.`);
    }
    if (!failure.includes("Cosmetic seed violation")) {
      throw new Error(`The ${name} CRLF rejection did not explain itself: ${failure}`);
    }
  }

  console.log("PASS cosmetic seed lint tests (LF and CRLF)");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
