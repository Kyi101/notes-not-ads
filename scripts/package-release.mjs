import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const allowDirty = process.argv.includes("--allow-dirty");
const manifest = JSON.parse(
  await readFile(path.join(projectRoot, "manifest.json"), "utf8")
);
const version = manifest.version;
const outputDir = path.join(projectRoot, "dist");
const outputPath = path.join(outputDir, `attention-redirector-${version}.zip`);
const requiredReleasePaths = [
  "manifest.json",
  "popup.html",
  "popup.css",
  "popup.js",
  "options.html",
  "options.css",
  "options.js",
  "src/background.js",
  "src/content.css",
  "src/content.js",
  "src/cosmetic-filters.js",
  "rules/rules_1.json",
  "rules/easylist_dnr.json"
];
const optionalReleaseDirs = ["icons", "_locales"];

if (!allowDirty) {
  try {
    execFileSync("git", ["diff-index", "--quiet", "HEAD", "--"], {
      cwd: projectRoot,
      stdio: "pipe"
    });
  } catch (_error) {
    throw new Error(
      "Release package requires a clean Git worktree. Commit changes or pass --allow-dirty for local inspection only."
    );
  }
}

mkdirSync(outputDir, { recursive: true });
rmSync(outputPath, { force: true });

const trackedFiles = new Set(
  execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], {
    cwd: projectRoot,
    encoding: "utf8"
  })
    .split("\n")
    .filter(Boolean)
);
const missingRequiredPaths = requiredReleasePaths.filter((filePath) => {
  return !trackedFiles.has(filePath);
});

if (missingRequiredPaths.length) {
  throw new Error(
    `Release package is missing required tracked files: ${missingRequiredPaths.join(", ")}`
  );
}

const optionalTrackedPaths = [...trackedFiles].filter((filePath) => {
  return optionalReleaseDirs.some((dir) => {
    return filePath === dir || filePath.startsWith(`${dir}/`);
  });
});
const releasePaths = [...requiredReleasePaths, ...optionalTrackedPaths];

execFileSync(
  "git",
  ["archive", "--format=zip", `--output=${outputPath}`, "HEAD", ...releasePaths],
  {
    cwd: projectRoot,
    stdio: "inherit"
  }
);

console.log(`Wrote ${outputPath}`);
console.log(`Included ${releasePaths.length} runtime files.`);
