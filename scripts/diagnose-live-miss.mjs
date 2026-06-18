import { chromium } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const targetUrl = process.argv[2];

if (!targetUrl) {
  console.error("Usage: node scripts/diagnose-live-miss.mjs <url>");
  process.exit(1);
}

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(projectRoot, "runs", "live-miss-diagnostics", runId);
const userDataDir = await mkdtemp(
  path.join(os.tmpdir(), "attention-redirector-live-miss-")
);
const requests = [];
const popups = [];
let context;

try {
  await mkdir(runDir, { recursive: true });
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1365, height: 900 },
    args: [
      `--disable-extensions-except=${projectRoot}`,
      `--load-extension=${projectRoot}`
    ]
  });

  context.on("page", (page) => {
    if (page.url() === "about:blank") {
      return;
    }
    popups.push({ openedAt: new Date().toISOString(), url: page.url() });
  });

  const page = await context.newPage();
  page.on("request", (request) => {
    requests.push({
      resourceType: request.resourceType(),
      url: request.url()
    });
  });

  await page.goto(targetUrl, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });
  await page.waitForTimeout(5000);

  await page.screenshot({
    path: path.join(runDir, "initial.png"),
    fullPage: false
  });

  for (let index = 0; index < 5; index += 1) {
    await page.evaluate(() => {
      window.scrollBy(0, Math.max(500, window.innerHeight * 0.82));
    });
    await page.waitForTimeout(1000);
  }

  const safePoint = await page.evaluate(() => {
    const candidates = [
      [12, Math.round(innerHeight * 0.5)],
      [Math.round(innerWidth * 0.5), Math.round(innerHeight * 0.88)],
      [Math.round(innerWidth * 0.94), Math.round(innerHeight * 0.5)]
    ];

    for (const [x, y] of candidates) {
      const element = document.elementFromPoint(x, y);
      if (
        element instanceof HTMLElement &&
        !element.closest("a,button,input,select,textarea,[role='button']")
      ) {
        return { x, y, signature: getSignature(element) };
      }
    }

    return null;

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

  if (safePoint) {
    await page.mouse.click(safePoint.x, safePoint.y);
    await page.waitForTimeout(4000);
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: path.join(runDir, "after-interaction.png"),
    fullPage: false
  });

  const dom = await page.evaluate(() => {
    return {
      url: location.href,
      title: document.title,
      cards: document.querySelectorAll(".attention-redirector-card").length,
      frames: Array.from(document.querySelectorAll("iframe")).map(describeElement),
      fixedOrSticky: Array.from(document.querySelectorAll("body *"))
        .filter((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            (style.position === "fixed" || style.position === "sticky") &&
            rect.width >= 120 &&
            rect.height >= 40
          );
        })
        .slice(0, 80)
        .map(describeElement),
      scriptSources: Array.from(document.scripts)
        .map((script) => script.src)
        .filter(Boolean),
      blankLargeElements: Array.from(
        document.querySelectorAll("div,section,aside,ins")
      )
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          const text = String(element.innerText || "").trim();
          return (
            rect.width >= 250 &&
            rect.height >= 80 &&
            rect.height <= 700 &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            text.length < 24
          );
        })
        .slice(0, 120)
        .map(describeElement)
    };

    function describeElement(element) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        signature: getSignature(element),
        rect: {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          top: Math.round(rect.top),
          left: Math.round(rect.left)
        },
        position: style.position,
        zIndex: style.zIndex,
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        src: element.getAttribute("src") || "",
        dataSrc: element.getAttribute("data-src") || "",
        srcdoc: String(element.getAttribute("srcdoc") || "").slice(0, 300),
        backgroundImage: style.backgroundImage,
        text: String(element.innerText || element.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 180)
      };
    }

    function getSignature(element) {
      const tag = element.localName || "element";
      const id = element.id ? `#${element.id}` : "";
      const classes = Array.from(element.classList || [])
        .slice(0, 7)
        .map((className) => `.${className}`)
        .join("");
      return `${tag}${id}${classes}`;
    }
  });

  const report = {
    runId,
    targetUrl,
    safePoint,
    dom,
    popups,
    requestHosts: summarizeRequestHosts(requests, dom.url),
    suspiciousRequests: requests.filter((request) => {
      return /(^|[./_-])(ad|ads|advert|banner|click|pop|promo|track|vast|prebid)([./_?-]|$)/i.test(
        request.url
      );
    })
  };

  await writeFile(
    path.join(runDir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`
  );

  console.log(`Report: ${path.join(runDir, "report.json")}`);
  console.log(`Cards: ${dom.cards}`);
  console.log(`Frames: ${dom.frames.length}`);
  console.log(`Fixed/sticky: ${dom.fixedOrSticky.length}`);
  console.log(`Popups: ${popups.length}`);
  console.log(`Suspicious requests: ${report.suspiciousRequests.length}`);
} finally {
  if (context) {
    await context.close();
  }
  await rm(userDataDir, { recursive: true, force: true });
}

function summarizeRequestHosts(allRequests, finalUrl) {
  const pageHost = new URL(finalUrl).hostname;
  const hosts = new Map();

  for (const request of allRequests) {
    let host;
    try {
      host = new URL(request.url).hostname;
    } catch (_error) {
      continue;
    }

    if (!host || host === pageHost) {
      continue;
    }

    const record = hosts.get(host) || {
      host,
      count: 0,
      resourceTypes: new Set()
    };
    record.count += 1;
    record.resourceTypes.add(request.resourceType);
    hosts.set(host, record);
  }

  return Array.from(hosts.values())
    .map((record) => ({
      host: record.host,
      count: record.count,
      resourceTypes: Array.from(record.resourceTypes).sort()
    }))
    .sort((a, b) => b.count - a.count);
}
