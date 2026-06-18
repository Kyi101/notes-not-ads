import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const extensionRoot = projectRoot;
const targetUrl = process.env.ADBLOCK_TESTER_URL || "https://adblock-tester.com/";
const waitMs = Number.parseInt(process.env.ADBLOCK_TESTER_WAIT_MS || "12000", 10);
const minScore = Number.parseInt(process.env.ADBLOCK_TESTER_MIN_SCORE || "80", 10);
const userDataDir = await mkdtemp(path.join(os.tmpdir(), "attention-redirector-adblock-tester-"));

let context;

try {
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionRoot}`,
      `--load-extension=${extensionRoot}`
    ]
  });

  const { extensionId, serviceWorker } = await findExtensionContext(context);
  const page = await context.newPage();
  const networkEvents = [];
  page.on("requestfinished", (request) => {
    const url = request.url();
    if (shouldRecordRequest(url)) {
      networkEvents.push({
        status: "finished",
        resourceType: request.resourceType(),
        url
      });
    }
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (shouldRecordRequest(url)) {
      networkEvents.push({
        status: "failed",
        resourceType: request.resourceType(),
        failure: request.failure()?.errorText || "",
        url
      });
    }
  });
  await page.goto(targetUrl, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });

  await page.waitForTimeout(waitMs);

  const tabId = serviceWorker
    ? await findPageTabId(serviceWorker, page.url())
    : null;
  const status = tabId
    ? await sendExtensionMessage(serviceWorker, tabId, { type: "AR_GET_STATUS" })
    : null;

  const result = await page.evaluate(() => {
    const text = document.body ? document.body.innerText : "";
    const scoreLine =
      text
        .split(/\n/)
        .map((line) => line.trim())
        .find((line) => /\d+\s+points\s+out\s+of\s+100/i.test(line)) || "";
    const failedLines = text
      .split(/\n/)
      .map((line) => line.trim())
      .filter((line) => /test (has most likely )?failed|❌|⚠️/i.test(line))
      .slice(0, 30);

    return {
      url: location.href,
      title: document.title,
      scoreLine,
      checks: parseChecks(text),
      failedLines,
      attentionSlots: document.querySelectorAll(".attention-redirector-slot").length,
      attentionCards: document.querySelectorAll(".attention-redirector-card").length
    };

    function parseChecks(sourceText) {
      const lines = sourceText
        .split(/\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const records = [];
      let category = "";
      let service = "";

      for (const line of lines) {
        if (
          [
            "Contextual advertising",
            "Analytics Tools",
            "Banner advertising",
            "Error Monitoring"
          ].includes(line)
        ) {
          category = line;
          service = "";
          continue;
        }

        if (
          [
            "Custom",
            "Google AdSense",
            "Yandex Direct",
            "Google Analytics",
            "Hotjar",
            "Yandex.Metrica",
            "Flash banners",
            "Gif image",
            "Static image",
            "Sentry",
            "Bugsnag"
          ].includes(line)
        ) {
          service = line;
          continue;
        }

        const match =
          line.match(/^\d+\.\s+([^:]+):\s+(.+)$/) ||
          line.match(/^(Script loading|Script execution|File loading|Block visibility):\s+(.+)$/);
        if (match) {
          records.push({
            category,
            service,
            check: match[1].trim(),
            result: match[2].trim()
          });
        }
      }

      return records;
    }
  });

  console.log("extension id:", extensionId);
  console.log("url:", result.url);
  console.log("title:", result.title);
  console.log("score:", result.scoreLine || "not found");
  console.log("minimum score:", `${minScore}/100`);
  console.log("cards inserted:", status ? status.inserted : "unknown");
  console.log("visible AR slots:", result.attentionSlots);
  console.log("visible AR cards:", result.attentionCards);
  console.log("");
  console.log("check details:");
  result.checks.forEach((check) => {
    console.log(
      `- ${check.category} / ${check.service} / ${check.check}: ${check.result}`
    );
  });
  console.log("");
  console.log("recorded network events:");
  networkEvents.slice(0, 80).forEach((event) => {
    const suffix = event.status === "failed" ? ` ${event.failure}` : "";
    console.log(`- ${event.status} ${event.resourceType}${suffix} ${event.url}`);
  });
  console.log("");
  console.log("failed/warning checks:");
  if (result.failedLines.length) {
    result.failedLines.forEach((line) => {
      console.log(`- ${line}`);
    });
  } else {
    console.log("- none found in page text");
  }
  console.log("");
  console.log("interpretation:");
  console.log("- DOM/cosmetic replacement can affect visible ad blocks.");
  console.log("- Static MV3 declarativeNetRequest rules handle common network blocks; script execution and anti-adblock scriptlets remain future layers.");

  const score = parseScore(result.scoreLine);
  if (!Number.isFinite(score)) {
    throw new Error("Could not parse adblock-tester score.");
  }
  if (score < minScore) {
    throw new Error(
      `Adblock-tester score ${score}/100 is below required minimum ${minScore}/100.`
    );
  }
} finally {
  if (context) {
    await context.close();
  }
  await rm(userDataDir, { recursive: true, force: true });
}

function shouldRecordRequest(url) {
  return /googlesyndication|google-analytics|googletagmanager|googleadservices|yandex|mc\.yandex|hotjar|sentry|bugsnag|doubleclick|adservice|banner|adblock-tester|pagead|adsbygoogle|analytics|metric|gif|swf|flash/i.test(url);
}

function parseScore(scoreLine) {
  const match = String(scoreLine || "").match(/(\d+)\s+points\s+out\s+of\s+100/i);
  return match ? Number.parseInt(match[1], 10) : Number.NaN;
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
