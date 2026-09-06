// A CRLF checkout must build the same bundle as an LF one.
//
// Reported as #6: on Windows with core.autocrlf=true every source line arrives
// with a trailing \r. The builder split on "\n" alone, so each \r survived into
// src/content.js as trailing whitespace on every line of the shipped script —
// silently, since nothing compares the bundle against anything.
//
// build-content.mjs resolves its root from its own location, so both builds run
// against a throwaway tree rather than needing the script to grow a flag.
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "attention-redirector-build-eol-"));

async function buildIn(name, toCrlf) {
  const root = path.join(tempDir, name);
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await mkdir(path.join(root, "src"), { recursive: true });
  await copyFile(
    path.join(projectRoot, "scripts/build-content.mjs"),
    path.join(root, "scripts/build-content.mjs")
  );

  for (const entry of await readdir(path.join(projectRoot, "src"))) {
    if (!entry.endsWith(".js")) continue;
    const source = await readFile(path.join(projectRoot, "src", entry), "utf8");
    const normalized = source.replace(/\r\n/g, "\n");
    await writeFile(
      path.join(root, "src", entry),
      toCrlf ? normalized.replace(/\n/g, "\r\n") : normalized,
      "utf8"
    );
  }

  await run(process.execPath, [path.join(root, "scripts/build-content.mjs")]);
  return readFile(path.join(root, "src/content.js"), "utf8");
}

try {
  const [lf, crlf] = await Promise.all([buildIn("lf", false), buildIn("crlf", true)]);

  if (crlf.includes("\r")) {
    const line = crlf.split("\n").findIndex((entry) => entry.includes("\r")) + 1;
    throw new Error(
      `A CRLF checkout produced a bundle carrying carriage returns, first at line ${line}. Every line of the shipped content script would end in trailing whitespace.`
    );
  }

  if (lf !== crlf) {
    throw new Error(
      "The same sources built to different bundles under LF and CRLF. The line ending of a contributor's checkout must not change what ships."
    );
  }

  const committed = await readFile(path.join(projectRoot, "src/content.js"), "utf8");
  if (committed.includes("\r")) {
    throw new Error(
      "The committed src/content.js carries carriage returns. Rebuild it on a checkout with LF endings."
    );
  }

  console.log(`PASS build content line endings (${lf.length} bytes, identical under LF and CRLF)`);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
