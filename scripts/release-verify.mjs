// The gate between "it works on my machine" and an upload to the Web Store.
//
// package-release.mjs builds a deterministic allowlisted ZIP from the working
// tree, whatever state that tree is in, and prints "Run `git status --short`"
// only after the archive is already written. So the two ways a bad artifact
// gets uploaded are both silent: a dirty tracked tree, and a src/content.js
// that no longer matches the partials it was generated from. Either produces a
// ZIP that looks valid and cannot be traced to anything that was tested.
//
// This wrapper refuses both, in the cheap-first order, then runs the gates and
// packages. The low-level packager is deliberately left alone so tests and local
// experiments can still call it directly. Reported as #9.
//
// Usage: npm run release:verify
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

// `git status --porcelain` prints one line per path and nothing at all for a
// clean tree; a "??" prefix marks an untracked one.
//
// Most untracked files are none of this gate's business — STATUS.md, runs/ and
// dist/ are untracked by design and must not block a release. But the packager
// collects fonts/, icons/ and _locales/ by scanning the directory, so an
// untracked file sitting in one of those ships without ever having been
// committed, which is exactly the traceability this gate is supposed to
// guarantee. Those are reported; the rest are ignored.
const PACKAGED_SCANNED_DIRS = ["fonts/", "icons/", "_locales/"];

export function describeDirtyTree(porcelain) {
  const problems = [];

  for (const raw of String(porcelain || "").split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;

    const status = line.slice(0, 2);
    const file = line.slice(2).trim().replace(/^"|"$/g, "");
    if (!file) continue;

    if (status === "??") {
      if (PACKAGED_SCANNED_DIRS.some((dir) => file.startsWith(dir))) {
        problems.push(`${file} (untracked, but inside a packaged directory)`);
      }
      continue;
    }

    problems.push(file);
  }

  return problems.length ? problems : null;
}

// The bundle is generated, so the only honest test is to generate it again and
// compare. Line endings are normalized first: a CRLF checkout would otherwise
// report every file as stale (see #6).
export function isBundleStale(committed, rebuilt) {
  const normalize = (text) => String(text || "").replace(/\r\n/g, "\n");
  return normalize(committed) !== normalize(rebuilt);
}

// An artifact already on disk for this version is evidence that this version was
// already built, and possibly already uploaded. Replacing it silently is how a
// digest recorded with a store submission stops describing any file that exists:
// `dist/notes-not-ads-1.0.3.zip` was rebuilt at a later revision during the
// 1.0.4 work and quietly became a different archive, so the digest submitted
// with 1.0.3 no longer matched anything local.
//
// A byte-identical rebuild is fine and expected — the packager is deterministic,
// so re-running the gate on the same revision reproduces the same archive. Only a
// rebuild that would change the bytes is refused.
export function describeArtifactClobber({ version, existingDigest, builtDigest }) {
  if (!existingDigest || existingDigest === builtDigest) {
    return null;
  }

  return [
    `Refusing to replace the existing ${version} artifact: rebuilding it here would change its bytes.`,
    `  on disk  ${existingDigest}`,
    `  rebuilt  ${builtDigest}`,
    "",
    "If that version was uploaded, its recorded digest describes the file on disk, and overwriting",
    "it destroys the only local copy of what shipped. Bump the version instead.",
    "If it was never uploaded, delete the file and run this again, or pass --replace."
  ].join("\n");
}

async function main() {
  const step = (message) => console.log(`\n== ${message}`);

  step("Tracked worktree must be clean");
  // Untracked files are listed too, so the packaged scan directories can be
  // checked; describeDirtyTree ignores the rest.
  const { stdout: porcelain } = await run(
    "git",
    ["status", "--porcelain"],
    { cwd: projectRoot }
  );
  const dirty = describeDirtyTree(porcelain);
  if (dirty) {
    console.error(
      [
        "Refusing to package: these tracked files have uncommitted changes.",
        ...dirty.map((entry) => `  ${entry}`),
        "",
        "A ZIP built from an uncommitted tree cannot be traced back to anything that was tested.",
        "Commit or stash first, or call scripts/package-release.mjs directly for a local build."
      ].join("\n")
    );
    process.exit(1);
  }
  console.log("clean");

  step("Generated bundle must match its sources");
  const committedBundle = await readFile(path.join(projectRoot, "src/content.js"), "utf8");
  await run(process.execPath, [path.join(projectRoot, "scripts/build-content.mjs")], {
    cwd: projectRoot
  });
  const rebuiltBundle = await readFile(path.join(projectRoot, "src/content.js"), "utf8");
  if (isBundleStale(committedBundle, rebuiltBundle)) {
    console.error(
      [
        "Refusing to package: src/content.js did not match a fresh build of its partials.",
        "It has now been rebuilt. Review the diff and commit it, then run this again.",
        "The committed bundle is what ships; a stale one ships code nobody reviewed."
      ].join("\n")
    );
    process.exit(1);
  }
  console.log("up to date");

  for (const [label, script] of [
    ["Deterministic gates", "check"],
    ["Browser smoke", "test:extension"]
  ]) {
    step(label);
    await run("npm", ["run", script], { cwd: projectRoot, maxBuffer: 64 * 1024 * 1024 });
    console.log("passed");
  }

  step("Package");
  const manifest = JSON.parse(
    await readFile(path.join(projectRoot, "manifest.json"), "utf8")
  );
  const zipPath = path.join(projectRoot, "dist", `notes-not-ads-${manifest.version}.zip`);

  // Read the existing archive before the packager deletes it, so a refusal can
  // put it back exactly as it was.
  let existing = null;
  try {
    existing = await readFile(zipPath);
  } catch (_error) {
    existing = null;
  }

  const { stdout: packed } = await run(
    process.execPath,
    [path.join(projectRoot, "scripts/package-release.mjs")],
    { cwd: projectRoot }
  );

  const digestOf = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const clobber = process.argv.includes("--replace")
    ? null
    : describeArtifactClobber({
        version: manifest.version,
        existingDigest: existing ? digestOf(existing) : "",
        builtDigest: digestOf(await readFile(zipPath))
      });

  if (clobber) {
    await writeFile(zipPath, existing);
    console.error(`\n${clobber}`);
    process.exit(1);
  }

  process.stdout.write(packed);
  const { stdout: revision } = await run("git", ["rev-parse", "HEAD"], { cwd: projectRoot });
  const digest = createHash("sha256").update(await readFile(zipPath)).digest("hex");

  console.log(
    [
      "",
      "== Ready to upload",
      `  version   ${manifest.version}`,
      `  revision  ${revision.trim()}`,
      `  artifact  ${path.relative(projectRoot, zipPath)}`,
      `  sha256    ${digest}`,
      "",
      "Record the digest with the submission so the uploaded file can be checked later."
    ].join("\n")
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
