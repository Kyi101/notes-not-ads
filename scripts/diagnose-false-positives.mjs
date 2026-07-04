import { chromium } from "@playwright/test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const casesPath = path.join(projectRoot, "evals/live-sites.json");
const runsRoot = path.join(projectRoot, "runs/fp-hunt");
const args = parseArgs(process.argv.slice(2));
const targets = await resolveTargets(args);

if (args.dryRun) {
  console.log("Dry run. Targets:");
  for (const target of targets) {
    console.log(`- ${target.id}: ${target.url}`);
  }
  process.exit(0);
}

if (!targets.length) {
  console.error("No targets. Use --url <url>, --case <id>, or --group real.");
  process.exit(1);
}

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(runsRoot, runId);
const userDataDir = await mkdtemp(
  path.join(os.tmpdir(), "attention-redirector-fp-hunt-")
);
const results = [];
let context;

try {
  await mkdir(runDir, { recursive: true });

  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${projectRoot}`,
      `--load-extension=${projectRoot}`
    ]
  });

  for (const target of targets) {
    const result = await captureTarget(context, target, args);
    results.push(result);
    printResult(result);
  }
} finally {
  if (context) {
    await context.close();
  }
  await rm(userDataDir, { recursive: true, force: true });
}

const report = {
  runId,
  finishedAt: new Date().toISOString(),
  args,
  totals: {
    targets: results.length,
    replacedSlots: results.reduce(
      (sum, result) => sum + (result.slots ? result.slots.length : 0),
      0
    ),
    errors: results.filter((result) => result.status === "error").length
  },
  results
};

await writeFile(
  path.join(runDir, "summary.json"),
  `${JSON.stringify(report, null, 2)}\n`
);
console.log(`\nReport: ${path.relative(projectRoot, runDir)}/summary.json`);

async function captureTarget(browserContext, target, options) {
  const page = await browserContext.newPage();

  try {
    await page.goto(target.url, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs
    });

    await page.waitForTimeout(Math.min(2500, options.waitMs));

    for (let index = 0; index < options.scrolls; index += 1) {
      await page.evaluate(() => {
        window.scrollBy(0, Math.max(400, window.innerHeight * 0.8));
      });
      await page.waitForTimeout(900);
    }

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(options.waitMs);

    const slots = await collectReplacedSlots(page);

    const pageShotPath = path.join(runDir, `${target.id}-page.png`);
    await page
      .screenshot({ path: pageShotPath, fullPage: true, timeout: 15000 })
      .catch(() => {});

    for (const [index, slot] of slots.entries()) {
      const locator = page
        .locator("[data-attention-redirector-replaced='true']")
        .nth(index);
      const slotShotPath = path.join(runDir, `${target.id}-slot-${index}.png`);
      try {
        await locator.scrollIntoViewIfNeeded({ timeout: 4000 });
        await locator.screenshot({ path: slotShotPath, timeout: 6000 });
        slot.screenshot = path.basename(slotShotPath);
      } catch (_error) {
        slot.screenshot = "";
      }
    }

    const finalUrl = page.url();
    const title = await page.title().catch(() => "");
    await page.close();

    return {
      id: target.id,
      url: target.url,
      finalUrl,
      title,
      status: "ok",
      slots
    };
  } catch (error) {
    await page.close().catch(() => {});
    return {
      id: target.id,
      url: target.url,
      status: "error",
      error: String((error && error.message) || error),
      slots: []
    };
  }
}

function collectReplacedSlots(page) {
  return page.evaluate(() => {
    function signature(element) {
      if (!element || !element.localName) {
        return "";
      }
      const id = element.id ? `#${element.id}` : "";
      const classes = Array.from(element.classList || [])
        .filter((name) => !name.startsWith("attention-redirector"))
        .slice(0, 6)
        .map((name) => `.${name}`)
        .join("");
      return `${element.localName}${id}${classes}`;
    }

    return Array.from(
      document.querySelectorAll("[data-attention-redirector-replaced='true']")
    ).map((slot) => {
      const rect = slot.getBoundingClientRect();
      const originalChildren = Array.from(slot.children).filter(
        (child) => !child.classList.contains("attention-redirector-card")
      );

      const originalText = originalChildren
        .map((child) => child.textContent || "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 260);

      const originalLinks = originalChildren
        .flatMap((child) =>
          Array.from(child.querySelectorAll("a[href]")).map((a) =>
            a.getAttribute("href")
          )
        )
        .filter(Boolean)
        .slice(0, 3);

      const originalSources = originalChildren
        .flatMap((child) =>
          Array.from(child.querySelectorAll("iframe,img,embed")).map(
            (node) => node.getAttribute("src") || node.getAttribute("data-src")
          )
        )
        .filter(Boolean)
        .map((value) =>
          value.length > 160 ? `${value.slice(0, 80)}...${value.slice(-60)}` : value
        )
        .slice(0, 4);

      const ancestry = [];
      let current = slot.parentElement;
      let depth = 0;
      while (current && current !== document.body && depth < 5) {
        ancestry.unshift(signature(current));
        current = current.parentElement;
        depth += 1;
      }

      return {
        reason: slot.dataset.attentionRedirectorReason || "",
        presentation: slot.dataset.attentionRedirectorPresentation || "",
        signature: signature(slot),
        ancestry,
        rect: {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          top: Math.round(rect.top + window.scrollY),
          left: Math.round(rect.left + window.scrollX)
        },
        originalText,
        originalLinks,
        originalSources
      };
    });
  });
}

function printResult(result) {
  if (result.status === "error") {
    console.log(`ERROR ${result.id}: ${result.error}`);
    return;
  }

  console.log(`${result.id}: ${result.slots.length} replaced slot(s)`);
  for (const slot of result.slots) {
    const text = slot.originalText
      ? ` text="${slot.originalText.slice(0, 80)}"`
      : "";
    console.log(
      `  [${slot.reason}] ${slot.signature} ${slot.rect.width}x${slot.rect.height}${text}`
    );
  }
}

async function resolveTargets(parsed) {
  const targets = [];

  if (parsed.caseIds.length || parsed.group) {
    const casesFile = JSON.parse(await readFile(casesPath, "utf8"));
    for (const testCase of casesFile.cases) {
      const byId = parsed.caseIds.includes(testCase.id);
      const byGroup = parsed.group && testCase.group === parsed.group;
      if (byId || byGroup) {
        targets.push({ id: testCase.id, url: testCase.url });
      }
    }
  }

  parsed.urls.forEach((url, index) => {
    let id = `url-${index}`;
    try {
      id = `${new URL(url).hostname.replace(/^www\./, "").replace(/[^a-z0-9.-]/gi, "-")}-${index}`;
    } catch (_error) {}
    targets.push({ id, url });
  });

  return parsed.limit > 0 ? targets.slice(0, parsed.limit) : targets;
}

function parseArgs(argv) {
  const parsed = {
    urls: [],
    caseIds: [],
    group: "",
    limit: 0,
    waitMs: 7000,
    scrolls: 3,
    timeoutMs: 45000,
    dryRun: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--url") {
      parsed.urls.push(argv[index + 1] || "");
      index += 1;
    } else if (arg === "--case") {
      parsed.caseIds.push(argv[index + 1] || "");
      index += 1;
    } else if (arg === "--group") {
      parsed.group = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--limit") {
      parsed.limit = Number.parseInt(argv[index + 1] || "0", 10) || 0;
      index += 1;
    } else if (arg === "--wait-ms") {
      parsed.waitMs = Number.parseInt(argv[index + 1] || "7000", 10) || 7000;
      index += 1;
    } else if (arg === "--scrolls") {
      parsed.scrolls = Number.parseInt(argv[index + 1] || "3", 10) || 3;
      index += 1;
    } else if (arg === "--timeout-ms") {
      parsed.timeoutMs = Number.parseInt(argv[index + 1] || "45000", 10) || 45000;
      index += 1;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    }
  }

  parsed.urls = parsed.urls.filter(Boolean);
  parsed.caseIds = parsed.caseIds.filter(Boolean);

  return parsed;
}
