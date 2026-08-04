import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const ALLOWED_ACTIONS = new Set(["block", "allow"]);
const MIN_FILTER_LENGTH = 4;
const MIN_ALLOW_DISCRIMINATOR = 4;
const DEFAULT_TARGETS = ["rules/rules_1.json", "rules/easylist_dnr.json"];

const supplied = process.argv.slice(2);
const targets = supplied.length
  ? supplied.map((file) => path.resolve(process.cwd(), file))
  : DEFAULT_TARGETS.map((file) => path.join(projectRoot, file));

for (const target of targets) {
  const label = path.relative(projectRoot, target) || target;
  const raw = await readFile(target, "utf8");

  let rules;
  try {
    rules = JSON.parse(raw);
  } catch (error) {
    throw new Error(`DNR lint violation: ${label} is not valid JSON — ${error.message}`);
  }

  if (!Array.isArray(rules) || rules.length < 1) {
    throw new Error(`DNR lint violation: ${label} must be a non-empty array of rules.`);
  }

  const seenIds = new Set();

  rules.forEach((rule, index) => {
    const where = `${label}[${index}]`;

    if (!Number.isInteger(rule?.id) || rule.id < 1) {
      throw new Error(`DNR lint violation: ${where} needs an integer id of 1 or more.`);
    }

    if (seenIds.has(rule.id)) {
      throw new Error(
        `DNR lint violation: ${where} repeats id ${rule.id}. Ids must be unique within a ruleset or Chrome drops the whole file.`
      );
    }
    seenIds.add(rule.id);

    const action = rule.action?.type;
    if (!ALLOWED_ACTIONS.has(action)) {
      throw new Error(
        `DNR lint violation: ${where} uses the action "${action}". Only block and allow ship — redirect and modifyHeaders would let a packaged rule rewrite traffic.`
      );
    }

    if (rule.condition?.regexFilter !== undefined) {
      throw new Error(
        `DNR lint violation: ${where} uses regexFilter, which makes breadth validation meaningless — length is not correlated with how many URLs it matches. Packaged rules use urlFilter only.`
      );
    }

    const filter = rule.condition?.urlFilter;
    if (typeof filter !== "string" || filter.length < 1) {
      throw new Error(
        `DNR lint violation: ${where} has no urlFilter. A rule must carry a non-empty urlFilter string.`
      );
    }
    const core = filter.replace(/[|^*]/g, "");
    if (core.length < MIN_FILTER_LENGTH) {
      throw new Error(
        `DNR lint violation: ${where} has the filter "${filter}", which matches too broadly. Give it a real host or path fragment.`
      );
    }

    if (action === "allow") {
      const scopeDomains = [
        ...(rule.condition?.initiatorDomains || []),
        ...(rule.condition?.requestDomains || [])
      ];
      for (const domain of scopeDomains) {
        // DNR matches a listed domain and every subdomain of it, so "com" is not
        // a scope — it is the whole TLD wearing one. Counting the array length
        // was enough to satisfy the check below while unblocking the tracker
        // everywhere the check exists to prevent.
        if (typeof domain !== "string" || !isScopableDomain(domain)) {
          throw new Error(
            `DNR lint violation: ${where} scopes an allow to "${domain}", which is not a scope. DNR matches the domain and all its subdomains, so a bare TLD unblocks the request across it. Name a registrable host.`
          );
        }
      }
      const scoped = scopeDomains.length;
      if (scoped < 1 && !carriesItsOwnScope(filter)) {
        throw new Error(
          `DNR lint violation: ${where} has the filter "${filter}" and no initiatorDomains or requestDomains. A bare host allow silently unblocks a tracker on every site; give it a domain scope or a path specific enough to name one resource.`
        );
      }
    }
  });

  console.log(`  ${label}: ${rules.length} rules`);
}

console.log("PASS DNR rule lint");

// A host-anchored allow needs no domain scope once it names a path or query
// beyond the host, because it can then only match that one resource. Deliberately
// re-implemented rather than imported from the list parser: a gate that shares
// code with what it inspects cannot catch that code being wrong.
// Requires a label under a public-looking suffix. This does not consult the
// public suffix list, so "example.co.uk" passes and "co.uk" would too; closing
// that would mean shipping and refreshing the PSL. It closes the hole that was
// actually open — a bare TLD counted as a scope.
function isScopableDomain(domain) {
  const labels = domain.trim().toLowerCase().split(".");
  if (labels.length < 2) return false;
  return labels.every((label) => /^[a-z0-9-]+$/.test(label));
}

function carriesItsOwnScope(urlFilter) {
  if (!urlFilter.startsWith("||")) return false;
  const rest = urlFilter.slice(2);
  const separator = rest.search(/[/^]/);
  if (separator < 0) return false;
  return rest.slice(separator + 1).replace(/[|^*]/g, "").length >= MIN_ALLOW_DISCRIMINATOR;
}
