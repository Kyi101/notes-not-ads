import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const contributing = await readFile(path.join(projectRoot, "CONTRIBUTING.md"), "utf8");
const security = await readFile(path.join(projectRoot, "SECURITY.md"), "utf8");
const codeowners = await readFile(path.join(projectRoot, ".github/CODEOWNERS"), "utf8");

// Read the two lists out of CONTRIBUTING.md rather than restating them here. A
// second copy of the closed list would drift: adding a file to the prose and
// forgetting the CODEOWNERS entry is exactly the mistake this test exists to catch,
// and a hardcoded list cannot catch it.
function pathsUnderHeading(prefix) {
  const lines = contributing.split("\n");
  const start = lines.findIndex((line) => line.startsWith(prefix));
  if (start < 0) throw new Error(`Governance contract violation: CONTRIBUTING.md has no "${prefix}" heading.`);
  const paths = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("#")) break;
    if (!line.startsWith("- ")) continue;
    // Only the part before the em dash names files; the rest is prose.
    for (const match of line.split(" — ")[0].matchAll(/`([^`]+)`/g)) paths.push(match[1]);
  }
  return paths;
}

const OPEN_PATHS = pathsUnderHeading("### Open to pull requests");
const CLOSED_PATHS = pathsUnderHeading("### Closed");

if (CLOSED_PATHS.length < 20 || OPEN_PATHS.length < 4) {
  throw new Error(
    `Governance contract violation: parsed only ${CLOSED_PATHS.length} closed and ${OPEN_PATHS.length} open paths out of CONTRIBUTING.md. The list format changed and this test is no longer reading it.`
  );
}

const ownedPatterns = codeowners
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => line.split(/\s+/)[0]);

for (const closedPath of CLOSED_PATHS) {
  const owned = ownedPatterns.some((pattern) => pattern.replace(/^\//, "") === closedPath);
  if (!owned) {
    throw new Error(
      `Governance contract violation: .github/CODEOWNERS has no entry for the closed path ${closedPath}, so a pull request touching it shows no ownership flag.`
    );
  }
}

for (const openPath of OPEN_PATHS) {
  // Both directions matter. /rules/rules_1.json claims a file inside an open
  // directory; /src/ claims an open file from above it. Only checking one way lets
  // a directory entry quietly swallow the open surface.
  const owned = ownedPatterns.some((pattern) => {
    const normalized = pattern.replace(/^\//, "");
    if (!normalized) return false;
    return normalized.startsWith(openPath) || openPath.startsWith(normalized);
  });
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
