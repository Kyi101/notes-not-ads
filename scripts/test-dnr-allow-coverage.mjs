// The sensitive-page allow must cover every resource type the packaged rules
// can block.
//
// On a bank, a checkout or a password manager the extension promises to do
// nothing at all. That promise is kept by installing a priority-1000 allow —
// but an allow names resource types, and a type missing from it stays blocked.
// The list had omitted `stylesheet` while 43 packaged rules block stylesheets,
// so a checkout page could lose its CSS on exactly the page where the extension
// claims zero footprint. `object` was missing too.
//
// Comparing the two sets is the only way this stays true: the block list is
// regenerated from EasyList and can introduce a type nobody thought about.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const background = await readFile(path.join(projectRoot, "src/background.js"), "utf8");
const declared = background.match(/const DNR_RESOURCE_TYPES = \[([^\]]*)\]/);
if (!declared) {
  throw new Error("src/background.js no longer declares DNR_RESOURCE_TYPES.");
}
const allowed = new Set(
  declared[1]
    .split(",")
    .map((entry) => entry.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean)
);

const manifest = JSON.parse(await readFile(path.join(projectRoot, "manifest.json"), "utf8"));
const rulePaths = (manifest.declarative_net_request?.rule_resources || []).map(
  (entry) => entry.path
);
if (!rulePaths.length) {
  throw new Error("The manifest declares no static rulesets to check against.");
}

const blocked = new Map();
for (const rulePath of rulePaths) {
  const rules = JSON.parse(await readFile(path.join(projectRoot, rulePath), "utf8"));
  for (const rule of rules) {
    if (rule.action?.type !== "block") continue;
    for (const type of rule.condition?.resourceTypes || []) {
      blocked.set(type, (blocked.get(type) || 0) + 1);
    }
  }
}

const uncovered = [...blocked.keys()].filter((type) => !allowed.has(type)).sort();
if (uncovered.length) {
  console.error(
    [
      "The sensitive-page allow does not cover every blocked resource type.",
      ...uncovered.map((type) => `  ${type}: blocked by ${blocked.get(type)} packaged rule(s), not allowed`),
      "",
      "On a sensitive page these stay blocked, so the zero-footprint promise is not kept.",
      "Add them to DNR_RESOURCE_TYPES in src/background.js."
    ].join("\n")
  );
  process.exit(1);
}

console.log(
  `PASS DNR allow coverage (${blocked.size} blocked resource types, all allowed on sensitive pages)`
);
