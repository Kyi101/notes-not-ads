import { chromium } from "@playwright/test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assessPageHealth } from "./live-eval-health.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { classifySitePolicy } = require("../src/site-policy.js");
const projectRoot = path.resolve(__dirname, "..");
const extensionRoot = projectRoot;
const casesPath = path.join(projectRoot, "evals/live-sites.json");
const runsRoot = path.join(projectRoot, "runs/live-site-evals");
const args = parseArgs(process.argv.slice(2));
const casesFile = JSON.parse(await readFile(casesPath, "utf8"));
const selectedCases = selectCases(casesFile.cases, args);

if (args.dryRun) {
  printDryRun(selectedCases, args);
  process.exit(0);
}

const manualCases = selectedCases.filter((testCase) => testCase.manualOnly);
if (manualCases.length > 0) {
  console.error(
    `Selected ${manualCases.length} manual-only case${manualCases.length === 1 ? "" : "s"}; use --dry-run to list them and test manually.`
  );
  process.exit(1);
}

if (!selectedCases.length) {
  console.error("No eval cases selected.");
  process.exit(1);
}

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(runsRoot, runId);
const userDataDir = await mkdtempInOs("attention-redirector-live-eval-");
const startedAt = new Date().toISOString();
const results = [];
let context;
let extensionId = "";
let serviceWorker = null;

try {
  await mkdir(runDir, { recursive: true });

  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionRoot}`,
      `--load-extension=${extensionRoot}`
    ]
  });

  const extensionContext = await findExtensionContext(context);
  extensionId = extensionContext.extensionId;
  serviceWorker = extensionContext.serviceWorker;

  for (const testCase of selectedCases) {
    const result = await runCase(context, serviceWorker, testCase, args);
    results.push(result);
    printCaseResult(result);
  }
} finally {
  if (context) {
    await context.close();
  }
  await rm(userDataDir, { recursive: true, force: true });
}

const finishedAt = new Date().toISOString();
const report = {
  runId,
  startedAt,
  finishedAt,
  extensionId,
  args,
  summary: summarizeResults(results),
  results
};

await writeFile(
  path.join(runDir, "summary.json"),
  `${JSON.stringify(report, null, 2)}\n`
);
await writeFile(path.join(runDir, "summary.md"), formatMarkdownReport(report));

printSummary(report, runDir);

if (results.some((result) => result.status === "error" || result.status === "fail")) {
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {
    dryRun: false,
    group: "",
    track: "",
    caseId: "",
    url: "",
    customId: "",
    limit: 0,
    waitMs: 9000,
    scrolls: 3,
    timeoutMs: 45000,
    failOnSuspects: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--group") {
      parsed.group = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--track") {
      parsed.track = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--case") {
      parsed.caseId = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--url") {
      parsed.url = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--id") {
      parsed.customId = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--limit") {
      parsed.limit = Number.parseInt(argv[index + 1] || "0", 10) || 0;
      index += 1;
    } else if (arg === "--wait-ms") {
      parsed.waitMs = Number.parseInt(argv[index + 1] || "9000", 10) || 9000;
      index += 1;
    } else if (arg === "--scrolls") {
      parsed.scrolls = Number.parseInt(argv[index + 1] || "3", 10) || 3;
      index += 1;
    } else if (arg === "--timeout-ms") {
      parsed.timeoutMs = Number.parseInt(argv[index + 1] || "45000", 10) || 45000;
      index += 1;
    } else if (arg === "--fail-on-suspects") {
      parsed.failOnSuspects = true;
    }
  }

  return parsed;
}

function selectCases(cases, options) {
  if (options.url) {
    return [
      {
        id: options.customId || slugFromUrl(options.url),
        group: options.group || "custom",
        url: options.url,
        notes: "One-off URL supplied on the command line."
      }
    ];
  }

  let selected = [...cases];

  if (!options.group && !options.track && !options.caseId) {
    selected = selected.filter((testCase) => {
      return testCase.manualOnly !== true && testCase.track !== "discovery";
    });
  }

  if (options.group) {
    selected = selected.filter((testCase) => testCase.group === options.group);
  }

  if (options.track) {
    selected = selected.filter((testCase) => testCase.track === options.track);
  }

  if (options.caseId) {
    selected = selected.filter((testCase) => testCase.id === options.caseId);
  }

  if (options.limit > 0) {
    selected = selected.slice(0, options.limit);
  }

  return selected;
}

function slugFromUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "").replace(/[^a-z0-9]+/gi, "-");
  } catch (_error) {
    return "custom-url";
  }
}

function printDryRun(cases, options) {
  console.log(`Selected ${cases.length} live eval case${cases.length === 1 ? "" : "s"}.`);
  console.log(`group: ${options.group || "all"}`);
  console.log(`track: ${options.track || "default regression+controlled"}`);
  console.log(`case: ${options.caseId || "all"}`);
  console.log(`url: ${options.url || "none"}`);
  console.log(`limit: ${options.limit || "none"}`);
  console.log("");
  cases.forEach((testCase) => {
    const sitePolicy = classifyEvalSitePolicy(testCase, { url: testCase.url });
    const expectation = formatPolicyExpectation(testCase.policy);
    const track = testCase.track || "untracked";
    const category = testCase.category || "uncategorized";
    const manual = testCase.manualOnly ? " manual-only" : "";
    console.log(
      `[DRY] ${testCase.group}/${testCase.id} track=${track} category=${category}${manual} policy=${sitePolicy.protocol}${expectation} ${testCase.url}`
    );
  });
}

async function runCase(context, worker, testCase, options) {
  const page = await context.newPage();
  const startedAt = new Date().toISOString();
  const initialSitePolicy = classifyEvalSitePolicy(testCase, {
    url: testCase.url
  });

  try {
    const navigationResponse = await page.goto(testCase.url, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs
    });
    const httpStatus = navigationResponse ? navigationResponse.status() : 0;

    await page.waitForTimeout(Math.min(2500, options.waitMs));
    await triggerScrolls(page, options);
    await page.waitForTimeout(options.waitMs);

    await page.bringToFront();
    const tabId = worker ? await findPageTabId(worker, page.url()) : null;
    const extensionStatus = tabId
      ? await sendExtensionMessage(worker, tabId, { type: "AR_GET_STATUS" })
      : null;
    const pageMetrics = await collectPageMetrics(page);
    const pageHealth = assessPageHealth({
      httpStatus,
      title: pageMetrics.title,
      bodyTextLength: pageMetrics.bodyTextLength
    });
    const sitePolicy = classifyEvalSitePolicy(testCase, {
      url: pageMetrics.url,
      pageMetrics
    });
    const policyCheck = assessPolicyExpectation(sitePolicy, testCase.policy);
    await page.close();

    const status =
      pageHealth
        ? "error"
        : policyCheck
          ? "fail"
        : options.failOnSuspects && pageMetrics.visibleAdSuspects.length > 0
          ? "fail"
          : "pass";

    return {
      id: testCase.id,
      group: testCase.group,
      track: testCase.track,
      category: testCase.category,
      url: testCase.url,
      finalUrl: pageMetrics.url,
      title: pageMetrics.title,
      notes: testCase.notes,
      status,
      httpStatus,
      startedAt,
      finishedAt: new Date().toISOString(),
      error: pageHealth ? pageHealth.message : policyCheck ? policyCheck.message : "",
      pageHealth,
      sitePolicy,
      initialSitePolicy,
      policyCheck,
      extensionStatus,
      metrics: pageMetrics
    };
  } catch (error) {
    await page.close().catch(() => {});
    return {
      id: testCase.id,
      group: testCase.group,
      track: testCase.track,
      category: testCase.category,
      url: testCase.url,
      notes: testCase.notes,
      status: "error",
      startedAt,
      finishedAt: new Date().toISOString(),
      error: String((error && error.message) || error),
      sitePolicy: initialSitePolicy
    };
  }
}

async function triggerScrolls(page, options) {
  for (let index = 0; index < options.scrolls; index += 1) {
    await page.evaluate(() => {
      window.scrollBy(0, Math.max(400, window.innerHeight * 0.8));
    });
    await page.waitForTimeout(900);
  }

  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
}

async function collectPageMetrics(page) {
  return page.evaluate(() => {
    const extensionSelector =
      ".attention-redirector-slot,.attention-redirector-card,.attention-redirector-inspector,.attention-redirector-inspector-box";
    const nodes = Array.from(
      document.querySelectorAll(
        [
          "iframe",
          "ins",
          "[id]",
          "[class]",
          "[aria-label]",
          "[data-ad-slot]",
          "[data-ad-client]"
        ].join(",")
      )
    );
    const visibleAdSuspects = [];

    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) {
        continue;
      }

      if (
        node.closest(extensionSelector) ||
        node.querySelector(extensionSelector)
      ) {
        continue;
      }

      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      if (
        rect.width < 120 ||
        rect.height < 40 ||
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number.parseFloat(style.opacity || "1") <= 0
      ) {
        continue;
      }

      const identifiers = [
        node.id,
        node.className,
        node.getAttribute("aria-label"),
        node.getAttribute("title"),
        node.getAttribute("data-ad-slot"),
        node.getAttribute("data-ad-client"),
        node.localName
      ]
        .filter(Boolean)
        .join(" ");
      const sourceText = Array.from(
        node.querySelectorAll("iframe,img,embed,source")
      )
        .filter((child) => {
          return !child.closest(extensionSelector);
        })
        .slice(0, 8)
        .map((child) => {
          return [
            child.getAttribute("src"),
            child.getAttribute("data-src"),
            child.getAttribute("srcdoc")
          ]
            .filter(Boolean)
            .join(" ");
        })
        .join(" ");
      const ownSource = [
        node.getAttribute("src"),
        node.getAttribute("data-src"),
        node.getAttribute("srcdoc")
      ]
        .filter(Boolean)
        .join(" ");
      const combined = `${identifiers} ${ownSource} ${sourceText}`;
      const text = String(node.innerText || node.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      const identifierAdLike =
        /(^|[\s_.:-])(ad|ads|advert|sponsor|sponsored|promoted|ad-container|ad-slot|ad-wrapper)([\s_.:-]|$)/i.test(
          identifiers
        );
      const broadTextContainer =
        style.position === "static" &&
        rect.height > 760 &&
        text.length > 300 &&
        node.children.length > 4 &&
        !identifierAdLike;

      if (broadTextContainer) {
        continue;
      }

      const scriptText = Array.from(node.querySelectorAll("script"))
        .slice(0, 4)
        .map((script) => script.textContent || "")
        .join(" ")
        .slice(0, 2200);
      const boundedAdRect =
        rect.width <= 1100 &&
        rect.height <= 340 &&
        rect.width * rect.height <= 260000;
      const sourceOrScriptAdLike = /google_ads_iframe|div-gpt-ad|adsbygoogle|adthrive|safeframe|doubleclick|googlesyndication|adservice|adserver|bidmatic|adtelligent|mgid|rcvlink|advertisement|advertising|sponsor|sponsored|promoted|реклама/i.test(
        `${combined} ${text} ${scriptText}`
      );
      const adLike =
        identifierAdLike || (sourceOrScriptAdLike && boundedAdRect);

      if (!adLike) {
        continue;
      }

      visibleAdSuspects.push({
        signature: getSignature(node),
        rect: {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          top: Math.round(rect.top),
          left: Math.round(rect.left)
        },
        text: text.slice(0, 140)
      });

      if (visibleAdSuspects.length >= 20) {
        break;
      }
    }

    return {
      url: location.href,
      title: document.title,
      attentionSlots: document.querySelectorAll(".attention-redirector-slot").length,
      attentionCards: document.querySelectorAll(".attention-redirector-card").length,
      visibleAdSuspects,
      bodyTextLength: document.body ? document.body.innerText.length : 0,
      domSignals: {
        passwordFields: document.querySelectorAll("input[type='password']").length,
        paymentForms: document.querySelectorAll(
          [
            "input[autocomplete='cc-number']",
            "input[name*='card' i]",
            "input[id*='card' i]",
            "input[name*='payment' i]",
            "input[id*='payment' i]"
          ].join(",")
        ).length,
        contentEditors: document.querySelectorAll("[contenteditable='true']").length
      }
    };

    function getSignature(element) {
      const tag = element.localName || "element";
      const id = element.id ? `#${element.id}` : "";
      const classes = Array.from(element.classList || [])
        .slice(0, 5)
        .map((className) => `.${className}`)
        .join("");
      return `${tag}${id}${classes}`;
    }
  });
}

function printCaseResult(result) {
  const marker =
    result.status === "pass" ? "[PASS]" : result.status === "fail" ? "[FAIL]" : "[ERROR]";
  if (result.status === "error") {
    console.log(`${marker} ${result.group}/${result.id}${formatResultTags(result)} ${result.error}`);
    return;
  }

  const policyText = result.sitePolicy ? ` policy=${result.sitePolicy.protocol}` : "";
  const policyMismatch = result.policyCheck ? " policy-mismatch" : "";
  console.log(
    `${marker} ${result.group}/${result.id}${formatResultTags(result)}${policyText}${policyMismatch} cards=${result.metrics.attentionCards} suspects=${result.metrics.visibleAdSuspects.length} ${result.finalUrl}`
  );
}

function formatResultTags(result) {
  const parts = [];
  if (result.track) {
    parts.push(`track=${result.track}`);
  }
  if (result.category) {
    parts.push(`category=${result.category}`);
  }
  return parts.length ? ` ${parts.join(" ")}` : "";
}

function summarizeResults(items) {
  const summary = {
    total: items.length,
    pass: 0,
    fail: 0,
    error: 0,
    cards: 0,
    visibleAdSuspects: 0,
    policyMismatches: 0,
    policyTiers: {},
    policyProtocols: {}
  };

  items.forEach((item) => {
    summary[item.status] += 1;
    if (item.policyCheck) {
      summary.policyMismatches += 1;
    }
    if (item.sitePolicy) {
      incrementCount(summary.policyTiers, item.sitePolicy.tier);
      incrementCount(summary.policyProtocols, item.sitePolicy.protocol);
    }
    if (item.metrics && item.status !== "error") {
      summary.cards += item.metrics.attentionCards;
      summary.visibleAdSuspects += item.metrics.visibleAdSuspects.length;
    }
  });

  return summary;
}

function printSummary(report, runDir) {
  const summary = report.summary;
  console.log("");
  console.log(
    `Summary: total=${summary.total} pass=${summary.pass} fail=${summary.fail} error=${summary.error} cards=${summary.cards} visibleSuspects=${summary.visibleAdSuspects} policyMismatches=${summary.policyMismatches}`
  );
  console.log(`Report: ${runDir}`);
}

function formatMarkdownReport(report) {
  const lines = [
    "# Attention Redirector Live Eval",
    "",
    `Run: ${report.runId}`,
    `Started: ${report.startedAt}`,
    `Finished: ${report.finishedAt}`,
    `Extension: ${report.extensionId}`,
    "",
    "## Summary",
    "",
    `- Total: ${report.summary.total}`,
    `- Pass: ${report.summary.pass}`,
    `- Fail: ${report.summary.fail}`,
    `- Error: ${report.summary.error}`,
    `- Cards: ${report.summary.cards}`,
    `- Visible ad suspects: ${report.summary.visibleAdSuspects}`,
    `- Policy mismatches: ${report.summary.policyMismatches}`,
    `- Policy protocols: ${formatCountMap(report.summary.policyProtocols)}`,
    "",
    "## Cases"
  ];

  report.results.forEach((result) => {
    lines.push("", `### ${result.group}/${result.id}`, "");
    lines.push(`- Status: ${result.status}`);
    if (result.track) {
      lines.push(`- Track: ${result.track}`);
    }
    if (result.category) {
      lines.push(`- Category: ${result.category}`);
    }
    lines.push(`- URL: ${result.url}`);
    if (result.finalUrl) {
      lines.push(`- Final URL: ${result.finalUrl}`);
    }
    if (Number.isFinite(result.httpStatus)) {
      lines.push(`- HTTP status: ${result.httpStatus}`);
    }
    if (result.sitePolicy) {
      lines.push(`- Site policy: ${result.sitePolicy.tier} / ${result.sitePolicy.protocol}`);
      if (result.policyCheck) {
        lines.push(`- Policy check: ${result.policyCheck.message}`);
      }
    }
    if (result.metrics) {
      lines.push(`- Cards: ${result.metrics.attentionCards}`);
      lines.push(`- Slots: ${result.metrics.attentionSlots}`);
      lines.push(`- Visible ad suspects: ${result.metrics.visibleAdSuspects.length}`);
      result.metrics.visibleAdSuspects.slice(0, 5).forEach((suspect) => {
        lines.push(
          `  - ${suspect.signature} ${suspect.rect.width}x${suspect.rect.height} at ${suspect.rect.left},${suspect.rect.top}`
        );
      });
    }
    if (result.error) {
      lines.push(`- Error: ${result.error}`);
    }
  });

  return `${lines.join("\n")}\n`;
}

function classifyEvalSitePolicy(testCase, { url, pageMetrics } = {}) {
  const policy = testCase.policy || {};
  return classifySitePolicy({
    url: url || testCase.url,
    domSignals: {
      ...(policy.domSignals || {}),
      ...(pageMetrics ? pageMetrics.domSignals || {} : {})
    },
    pageSignals: {
      ...(policy.pageSignals || {})
    },
    knownBreakage: policy.knownBreakage === true,
    knownBreakageDomains: policy.knownBreakageDomains || []
  });
}

function assessPolicyExpectation(sitePolicy, policy = {}) {
  if (!policy.expectedTier && !policy.expectedProtocol) {
    return null;
  }

  const failures = [];
  if (policy.expectedTier && sitePolicy.tier !== policy.expectedTier) {
    failures.push(`tier expected ${policy.expectedTier}, got ${sitePolicy.tier}`);
  }
  if (policy.expectedProtocol && sitePolicy.protocol !== policy.expectedProtocol) {
    failures.push(
      `protocol expected ${policy.expectedProtocol}, got ${sitePolicy.protocol}`
    );
  }

  if (!failures.length) {
    return null;
  }

  return {
    code: "site-policy-mismatch",
    message: failures.join("; ")
  };
}

function formatPolicyExpectation(policy = {}) {
  const parts = [];
  if (policy.expectedTier) {
    parts.push(`tier=${policy.expectedTier}`);
  }
  if (policy.expectedProtocol) {
    parts.push(`protocol=${policy.expectedProtocol}`);
  }
  return parts.length ? ` expected(${parts.join(" ")})` : "";
}

function incrementCount(target, key) {
  const normalized = key || "unknown";
  target[normalized] = (target[normalized] || 0) + 1;
}

function formatCountMap(value = {}) {
  const entries = Object.entries(value);
  if (!entries.length) {
    return "none";
  }
  return entries
    .map(([key, count]) => `${key}=${count}`)
    .join(", ");
}

async function findExtensionContext(context) {
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    try {
      serviceWorker = await context.waitForEvent("serviceworker", {
        timeout: 5000
      });
    } catch (_error) {
      serviceWorker = null;
    }
  }

  if (serviceWorker && serviceWorker.url().startsWith("chrome-extension://")) {
    return {
      extensionId: new URL(serviceWorker.url()).hostname,
      serviceWorker
    };
  }

  const page = await context.newPage();
  const cdpSession = await context.newCDPSession(page);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { targetInfos } = await cdpSession.send("Target.getTargets");
    const extensionTarget = targetInfos.find((target) => {
      return target.url.startsWith("chrome-extension://");
    });

    if (extensionTarget) {
      await page.close();
      return {
        extensionId: new URL(extensionTarget.url).hostname,
        serviceWorker: null
      };
    }

    await page.waitForTimeout(250);
  }

  await page.close();
  throw new Error("Could not find loaded extension id.");
}

async function findPageTabId(serviceWorker, pageUrl) {
  const tabs = await serviceWorker.evaluate(async () => {
    return chrome.tabs.query({});
  });

  const target = tabs.find((tab) => {
    return typeof tab.url === "string" && tab.url === pageUrl && tab.id;
  });

  if (target) {
    return target.id;
  }

  const active = tabs.find((tab) => {
    return tab.active && tab.id;
  });

  if (active) {
    return active.id;
  }

  throw new Error(`Could not find tab id for ${pageUrl}. Tabs: ${JSON.stringify(tabs)}`);
}

function sendExtensionMessage(serviceWorker, tabId, message) {
  return serviceWorker.evaluate(
    async ({ targetTabId, payload }) => {
      return chrome.tabs.sendMessage(targetTabId, payload);
    },
    { targetTabId: tabId, payload: message }
  );
}

async function mkdtempInOs(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}
