import { chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const extensionRoot = projectRoot;
const userDataDir = await mkdtemp(
  path.join(os.tmpdir(), "attention-redirector-controlled-testers-")
);

const allTargets = [
  ["canyoublockit-simple", "https://canyoublockit.com/testing/"],
  ["canyoublockit-extreme", "https://canyoublockit.com/extreme-test/"],
  ["getblockify", "https://getblockify.com/adblock-test"],
  ["turtlecute", "https://adblock.turtlecute.org/"]
];
const requestedCase = getArgValue("--case");
const targets = requestedCase
  ? allTargets.filter(([id]) => id === requestedCase)
  : allTargets;

if (requestedCase && targets.length < 1) {
  throw new Error(`Unknown controlled tester case: ${requestedCase}`);
}

let context;

try {
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionRoot}`,
      `--load-extension=${extensionRoot}`
    ]
  });

  for (const [id, url] of targets) {
    const page = await context.newPage();
    const networkEvents = [];
    page.on("requestfailed", (request) => {
      const requestUrl = request.url();
      if (shouldRecordRequest(requestUrl)) {
        networkEvents.push({
          status: "failed",
          resourceType: request.resourceType(),
          failure: request.failure()?.errorText || "",
          url: requestUrl
        });
      }
    });
    page.on("requestfinished", (request) => {
      const requestUrl = request.url();
      if (shouldRecordRequest(requestUrl)) {
        networkEvents.push({
          status: "finished",
          resourceType: request.resourceType(),
          url: requestUrl
        });
      }
    });

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45000
    });
    await exerciseTarget(id, page);
    await page.waitForTimeout(12000);

    const result = await page.evaluate(() => {
      const lines = (document.body?.innerText || "")
        .split(/\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const allText = lines.join("\n");
      const interestingLines = lines.filter((line) => {
        return /score|result|passed|failed|detected|not detected|blocked|not blocked|adblock|ads|track|percent|%/i.test(
          line
        );
      });
      const domainLines = lines.filter((line) => {
        return /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?$/i.test(line);
      });
      const gotThroughContext = collectSection(
        lines,
        /Ads That Got Through/i,
        /Successfully Blocked|Types of Ads|3\. Check the Results/i
      );
      const controls = Array.from(document.querySelectorAll("button, a"))
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          text: (element.textContent || "").trim().replace(/\s+/g, " "),
          href: element instanceof HTMLAnchorElement ? element.href : ""
        }))
        .filter((control) => control.text)
        .slice(0, 30);

      return {
        title: document.title,
        url: location.href,
        attentionSlots: document.querySelectorAll(".attention-redirector-slot").length,
        attentionCards: document.querySelectorAll(".attention-redirector-card").length,
        metrics: parseMetrics(allText),
        controls,
        domainLines: domainLines.slice(0, 120),
        gotThroughContext: gotThroughContext.slice(0, 120),
        interestingLines: interestingLines.slice(0, 80),
        bodyPreview: lines.slice(0, 80)
      };

      function parseMetrics(text) {
        const metricLines = text
          .split(/\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        const metrics = {};
        const turtlecute = text.match(/(\d+)\s+blocked[\s\S]*?(\d+)\s+not blocked/i);
        if (turtlecute) {
          metrics.blocked = Number.parseInt(turtlecute[1], 10);
          metrics.notBlocked = Number.parseInt(turtlecute[2], 10);
        }

        for (let index = 0; index < metricLines.length; index += 1) {
          const line = metricLines[index];
          if (/^Weighted Score:?$/i.test(line)) {
            metrics.weightedScore = nearbyPercent(metricLines, index);
          }
          if (/^Networks Blocked$/i.test(line)) {
            metrics.networksBlocked = nearbyPercent(metricLines, index);
          }
          if (/^Networks Passed$/i.test(line)) {
            metrics.networksPassed = nearbyPercent(metricLines, index);
          }
        }

        const standalonePercents = metricLines
          .map((line) => line.match(/^(\d{1,3})\s*%$/))
          .filter(Boolean)
          .map((match) => Number.parseInt(match[1], 10));
        if (standalonePercents.length) {
          metrics.percent = Number.isFinite(metrics.weightedScore)
            ? metrics.weightedScore
            : standalonePercents[0];
        }

        const outOf100 = text.match(/(\d{1,3})\s*(?:\/|out of)\s*100/i);
        if (outOf100) {
          metrics.outOf100 = Number.parseInt(outOf100[1], 10);
        }

        return metrics;
      }

      function nearbyPercent(linesToSearch, index) {
        const previous = linesToSearch[index - 1]?.match(/^(\d{1,3})\s*%$/);
        if (previous) {
          return Number.parseInt(previous[1], 10);
        }
        const next = linesToSearch[index + 1]?.match(/^(\d{1,3})\s*%$/);
        if (next) {
          return Number.parseInt(next[1], 10);
        }
        return null;
      }

      function collectSection(sourceLines, startPattern, endPattern) {
        const start = sourceLines.findIndex((line) => startPattern.test(line));
        if (start < 0) {
          return [];
        }
        const section = [];
        for (let index = start; index < sourceLines.length; index += 1) {
          if (index > start && endPattern.test(sourceLines[index])) {
            break;
          }
          section.push(sourceLines[index]);
        }
        return section;
      }
    });

    console.log(`\n=== ${id} ===`);
    console.log(`url: ${result.url}`);
    console.log(`title: ${result.title}`);
    console.log(`cards: ${result.attentionCards}`);
    console.log(`metrics: ${JSON.stringify(result.metrics)}`);
    if (result.controls.length) {
      console.log("visible controls:");
      result.controls.forEach((control) => {
        const href = control.href ? ` ${control.href}` : "";
        console.log(`- ${control.tag} ${control.text}${href}`);
      });
    }
    console.log("interesting text:");
    result.interestingLines.forEach((line) => console.log(`- ${line}`));
    if (result.gotThroughContext.length) {
      console.log("got-through context:");
      result.gotThroughContext.forEach((line) => console.log(`- ${line}`));
    }
    if (result.domainLines.length) {
      console.log("domain-like text:");
      result.domainLines.forEach((line) => console.log(`- ${line}`));
    }
    console.log("network:");
    networkEvents.slice(0, 80).forEach((event) => {
      const suffix = event.status === "failed" ? ` ${event.failure}` : "";
      console.log(`- ${event.status} ${event.resourceType}${suffix} ${event.url}`);
    });
    const nonDnrEvents = networkEvents.filter((event) => {
      return event.status !== "failed" || !/ERR_BLOCKED_BY_CLIENT/.test(event.failure || "");
    });
    if (nonDnrEvents.length) {
      console.log("non-DNR interesting outcomes:");
      nonDnrEvents.slice(0, 80).forEach((event) => {
        const suffix = event.status === "failed" ? ` ${event.failure}` : "";
        console.log(`- ${event.status} ${event.resourceType}${suffix} ${event.url}`);
      });
    }

    await page.close();
  }
} finally {
  if (context) {
    await context.close();
  }
  await rm(userDataDir, { recursive: true, force: true });
}

function shouldRecordRequest(url) {
  return /ad|ads|advert|banner|analytics|track|pixel|doubleclick|googlesyndication|googletagmanager|google-analytics|hotjar|sentry|bugsnag|yandex|taboola|outbrain|criteo|rubicon|pubmatic|adnxs/i.test(
    url
  );
}

async function exerciseTarget(id, page) {
  if (id !== "getblockify") {
    return;
  }

  const controls = [
    page.getByRole("button", { name: /start|run|test|check|detect|begin|scan/i }),
    page.getByRole("link", { name: /start|run|test|check|detect|begin|scan/i })
  ];

  for (const control of controls) {
    const count = await control.count();
    if (count < 1) {
      continue;
    }

    await control.first().click({ timeout: 5000 });
    await page.waitForTimeout(8000);
    await revealGetBlockifyDetails(page);
    return;
  }

  await revealGetBlockifyDetails(page);
}

async function revealGetBlockifyDetails(page) {
  const gotThrough = page.getByRole("button", { name: /Ads That Got Through/i });
  if ((await gotThrough.count()) > 0) {
    await gotThrough.first().click({ timeout: 5000 });
    await page.waitForTimeout(1000);
  }
}

function getArgValue(name) {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) {
    return equalsArg.slice(name.length + 1);
  }

  const index = process.argv.indexOf(name);
  if (index >= 0) {
    return process.argv[index + 1];
  }

  return "";
}
