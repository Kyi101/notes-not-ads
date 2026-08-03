import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const CLOSED_PATHS = [
  "src/main.js",
  "src/scanner.js",
  "src/replacer.js",
  "src/shared.js",
  "src/init.js",
  "src/background.js",
  "src/inspector.js",
  "src/site-policy.js",
  "src/youtube-prune-main.js",
  "src/youtube-prune-loader.js",
  "src/content.css",
  "manifest.json",
  "package.json",
  ".github/",
  "scripts/",
  "popup.js",
  "popup.html",
  "popup.css",
  "options.js",
  "options.html",
  "options.css",
  "welcome.js",
  "welcome.html",
  "welcome.css",
];

const OPEN_PATHS = [
  "rules/",
  "src/cosmetic-filters.js",
  "evals/live-sites.json",
  "tests/fixtures/"
];

const contributing = await readFile(path.join(projectRoot, "CONTRIBUTING.md"), "utf8");
const security = await readFile(path.join(projectRoot, "SECURITY.md"), "utf8");
const codeowners = await readFile(path.join(projectRoot, ".github/CODEOWNERS"), "utf8");

const ownedPatterns = codeowners
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => line.split(/\s+/)[0]);

for (const closedPath of CLOSED_PATHS) {
  if (!contributing.includes(closedPath)) {
    throw new Error(
      `Governance contract violation: CONTRIBUTING.md never mentions the closed path ${closedPath}.`
    );
  }
  const owned = ownedPatterns.some((pattern) => pattern.replace(/^\//, "") === closedPath);
  if (!owned) {
    throw new Error(
      `Governance contract violation: .github/CODEOWNERS has no entry for the closed path ${closedPath}, so a pull request touching it shows no ownership flag.`
    );
  }
}

for (const openPath of OPEN_PATHS) {
  if (!contributing.includes(openPath)) {
    throw new Error(
      `Governance contract violation: CONTRIBUTING.md never mentions the open path ${openPath}.`
    );
  }
  const owned = ownedPatterns.some((pattern) => pattern.replace(/^\//, "").startsWith(openPath));
  if (owned) {
    throw new Error(
      `Governance contract violation: .github/CODEOWNERS claims ${openPath}, which is open to outside pull requests. A catch-all makes the ownership flag meaningless.`
    );
  }
}

if (ownedPatterns.includes("*")) {
  throw new Error(
    "Governance contract violation: .github/CODEOWNERS uses a * catch-all, so every pull request shows the same flag and the open/closed split becomes invisible."
  );
}

if (!security.includes("/security/advisories/new")) {
  throw new Error(
    "Governance contract violation: SECURITY.md must link the private vulnerability reporting form."
  );
}

if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(security)) {
  throw new Error(
    "Governance contract violation: SECURITY.md contains an email address, but no support address exists yet. Link private vulnerability reporting instead."
  );
}

console.log(`PASS governance contract (${CLOSED_PATHS.length} closed paths, ${OPEN_PATHS.length} open paths)`);
