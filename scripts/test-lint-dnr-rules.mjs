import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const linter = path.join(__dirname, "lint-dnr-rules.mjs");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "attention-redirector-dnr-lint-"));

function blockRule(id, urlFilter) {
  return {
    id,
    priority: 1,
    action: { type: "block" },
    condition: { urlFilter, resourceTypes: ["script", "image", "xmlhttprequest"] }
  };
}

async function lint(name, rules) {
  const file = path.join(tempDir, `${name}.json`);
  await writeFile(file, typeof rules === "string" ? rules : JSON.stringify(rules, null, 2), "utf8");
  try {
    await run(process.execPath, [linter, file]);
    return null;
  } catch (error) {
    return String(error.stderr || error.message);
  }
}

async function expectReject(name, rules, expectedFragment) {
  const failure = await lint(name, rules);
  if (failure === null) {
    throw new Error(`${name} must be rejected, but the lint passed.`);
  }
  if (!failure.includes("DNR lint violation")) {
    throw new Error(`${name} rejection did not explain itself: ${failure}`);
  }
  if (!failure.includes(expectedFragment)) {
    throw new Error(`${name} rejection did not mention "${expectedFragment}": ${failure}`);
  }
}

try {
  const clean = await lint("clean", [
    blockRule(1, "||doubleclick.net^"),
    blockRule(2, "||googlesyndication.com^"),
    {
      id: 3,
      priority: 2,
      action: { type: "allow" },
      condition: { urlFilter: "||example.com^", initiatorDomains: ["example.com"] }
    }
  ]);
  if (clean !== null) {
    throw new Error(`A clean ruleset must pass, but the lint failed with: ${clean}`);
  }

  await expectReject("malformed JSON", "[{ not json", "valid JSON");
  await expectReject("empty ruleset", [], "non-empty array");
  await expectReject(
    "duplicate ids",
    [blockRule(7, "||doubleclick.net^"), blockRule(7, "||googlesyndication.com^")],
    "unique"
  );
  await expectReject("missing id", [{ ...blockRule(1, "||ads.example^"), id: undefined }], "integer id");
  await expectReject(
    "redirect action",
    [
      {
        id: 1,
        priority: 1,
        action: { type: "redirect", redirect: { url: "https://example.com/" } },
        condition: { urlFilter: "||doubleclick.net^", resourceTypes: ["script"] }
      }
    ],
    "redirect"
  );
  await expectReject("wildcard filter", [blockRule(1, "*")], "too broadly");
  await expectReject("short filter", [blockRule(1, "||ad^")], "too broadly");
  await expectReject(
    "unscoped allow",
    [
      {
        id: 1,
        priority: 2,
        action: { type: "allow" },
        condition: { urlFilter: "||tracker.example^", resourceTypes: ["script"] }
      }
    ],
    "unscoped allow"
  );
  await expectReject(
    "regexFilter on block rule",
    [
      {
        id: 1,
        priority: 1,
        action: { type: "block" },
        condition: { regexFilter: ".+.+.+.+" }
      }
    ],
    "regexFilter"
  );
  await expectReject(
    "regexFilter on scoped allow rule",
    [
      {
        id: 1,
        priority: 1,
        action: { type: "allow" },
        condition: { regexFilter: "^https?://.*", requestDomains: ["ads.example"] }
      }
    ],
    "regexFilter"
  );
  await expectReject(
    "both urlFilter and regexFilter",
    [
      {
        id: 1,
        priority: 1,
        action: { type: "block" },
        condition: { urlFilter: "||doubleclick.net^", regexFilter: ".+.+.+.+" }
      }
    ],
    "regexFilter"
  );
  await expectReject(
    "no filter field",
    [
      {
        id: 1,
        priority: 1,
        action: { type: "block" },
        condition: { resourceTypes: ["script"] }
      }
    ],
    "no urlFilter"
  );

  console.log("PASS DNR rule lint tests");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
