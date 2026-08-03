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

function seedSource(entries) {
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
  ].join("\n");
}

async function lint(name, entries) {
  const file = path.join(tempDir, `${name}.js`);
  await writeFile(file, seedSource(entries), "utf8");
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

  console.log("PASS cosmetic seed lint tests");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
