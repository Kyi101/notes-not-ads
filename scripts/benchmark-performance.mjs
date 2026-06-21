import { chromium } from "@playwright/test";
import http from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const fixturePath = path.join(
  projectRoot,
  "tests/fixtures/performance-scroll.html"
);
const runsRoot = path.join(projectRoot, "runs/performance");
const args = parseArgs(process.argv.slice(2));
const scenarios = [
  {
    id: "disabled",
    settings: {
      enabled: false,
      mode: "quiet",
      anchorNote: "Finish what deserves your attention.",
      anchorNotes: ["Finish what deserves your attention."],
      visualPresence: 10,
      reducedMotion: "system",
      disabledDomains: []
    }
  },
  {
    id: "still",
    settings: {
      enabled: true,
      mode: "quiet",
      anchorNote: "Finish what deserves your attention.",
      anchorNotes: ["Finish what deserves your attention."],
      visualPresence: 10,
      reducedMotion: "still",
      disabledDomains: []
    }
  },
  {
    id: "animated",
    settings: {
      enabled: true,
      mode: "quiet",
      anchorNote: "Finish what deserves your attention.",
      anchorNotes: ["Finish what deserves your attention."],
      visualPresence: 10,
      reducedMotion: "system",
      disabledDomains: []
    }
  }
];

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(runsRoot, runId);
const userDataDir = await mkdtemp(
  path.join(os.tmpdir(), "attention-redirector-performance-")
);
const server = await startFixtureServer();
const results = [];
let context;

try {
  await mkdir(runDir, { recursive: true });
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${projectRoot}`,
      `--load-extension=${projectRoot}`
    ]
  });

  const serviceWorker = await findServiceWorker(context);
  const fixtureUrl =
    `http://127.0.0.1:${server.port}/performance-scroll.html` +
    `?slots=${args.slots}`;

  for (const scenario of scenarios) {
    for (let run = 1; run <= args.runs; run += 1) {
      await saveExtensionSettings(serviceWorker, scenario.settings);
      const result = await runScenario(
        context,
        fixtureUrl,
        scenario,
        run,
        args
      );
      results.push(result);
      printResult(result);
    }
  }
} finally {
  if (context) {
    await context.close();
  }
  server.close();
  await rm(userDataDir, { recursive: true, force: true });
}

const report = {
  runId,
  generatedAt: new Date().toISOString(),
  args,
  results,
  summary: summarize(results)
};

await writeFile(
  path.join(runDir, "summary.json"),
  `${JSON.stringify(report, null, 2)}\n`
);
await writeFile(
  path.join(runDir, "summary.md"),
  formatMarkdown(report)
);

printSummary(report.summary, runDir);

function parseArgs(argv) {
  const parsed = {
    runs: 2,
    durationMs: 8000,
    slots: 60,
    scrollSpeed: 900
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = Number.parseInt(argv[index + 1] || "", 10);

    if (arg === "--runs" && Number.isFinite(value)) {
      parsed.runs = Math.max(1, Math.min(8, value));
      index += 1;
    } else if (arg === "--duration-ms" && Number.isFinite(value)) {
      parsed.durationMs = Math.max(2000, Math.min(60000, value));
      index += 1;
    } else if (arg === "--slots" && Number.isFinite(value)) {
      parsed.slots = Math.max(1, Math.min(120, value));
      index += 1;
    } else if (arg === "--scroll-speed" && Number.isFinite(value)) {
      parsed.scrollSpeed = Math.max(100, Math.min(4000, value));
      index += 1;
    }
  }

  return parsed;
}

async function runScenario(context, fixtureUrl, scenario, run, options) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");

  try {
    await page.goto(`${fixtureUrl}&scenario=${scenario.id}&run=${run}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    if (scenario.settings.enabled) {
      await page.waitForFunction(
        (expected) => {
          return (
            document.querySelectorAll(".attention-redirector-card").length ===
            expected
          );
        },
        options.slots,
        { timeout: 15000 }
      );
    } else {
      await page.waitForTimeout(1200);
    }

    await page.bringToFront();
    await page.waitForTimeout(800);
    const before = await readPerformanceMetrics(cdp);
    const frameMetrics = await measureScroll(page, options);
    const after = await readPerformanceMetrics(cdp);
    const cards = await page
      .locator(".attention-redirector-card")
      .count();
    const documentHeight = await page.evaluate(() => {
      return document.documentElement.scrollHeight;
    });

    return {
      scenario: scenario.id,
      run,
      cards,
      documentHeight,
      frameMetrics,
      browserMetrics: diffPerformanceMetrics(before, after, options.durationMs)
    };
  } finally {
    await page.close();
  }
}

function measureScroll(page, options) {
  return page.evaluate(
    ({ durationMs, scrollSpeed }) => {
      return new Promise((resolve) => {
        const frameDeltas = [];
        const startedAt = performance.now();
        let previousAt = startedAt;
        let scrollPosition = 0;
        let direction = 1;

        const step = (now) => {
          const delta = now - previousAt;
          if (previousAt !== startedAt) {
            frameDeltas.push(delta);
          }
          previousAt = now;

          const maxScroll = Math.max(
            0,
            document.documentElement.scrollHeight - innerHeight
          );
          scrollPosition += direction * scrollSpeed * (delta / 1000);

          if (scrollPosition >= maxScroll) {
            scrollPosition = maxScroll;
            direction = -1;
          } else if (scrollPosition <= 0) {
            scrollPosition = 0;
            direction = 1;
          }

          scrollTo(0, scrollPosition);

          if (now - startedAt < durationMs) {
            requestAnimationFrame(step);
            return;
          }

          frameDeltas.sort((a, b) => a - b);
          resolve({
            durationMs: now - startedAt,
            frames: frameDeltas.length,
            medianMs: percentile(frameDeltas, 0.5),
            p95Ms: percentile(frameDeltas, 0.95),
            p99Ms: percentile(frameDeltas, 0.99),
            maxMs: frameDeltas.at(-1) || 0,
            over20Ms: frameDeltas.filter((value) => value > 20).length,
            over32Ms: frameDeltas.filter((value) => value > 32).length,
            over50Ms: frameDeltas.filter((value) => value > 50).length
          });
        };

        requestAnimationFrame(step);

        function percentile(values, ratio) {
          if (!values.length) {
            return 0;
          }
          return values[Math.min(values.length - 1, Math.floor(values.length * ratio))];
        }
      });
    },
    {
      durationMs: options.durationMs,
      scrollSpeed: options.scrollSpeed
    }
  );
}

async function readPerformanceMetrics(cdp) {
  const response = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(
    response.metrics.map((metric) => [metric.name, metric.value])
  );
}

function diffPerformanceMetrics(before, after, durationMs) {
  const durationSeconds = durationMs / 1000;
  const delta = (name) => Math.max(0, (after[name] || 0) - (before[name] || 0));

  return {
    taskDurationMs: delta("TaskDuration") * 1000,
    taskUtilizationPercent:
      (delta("TaskDuration") / durationSeconds) * 100,
    scriptDurationMs: delta("ScriptDuration") * 1000,
    layoutDurationMs: delta("LayoutDuration") * 1000,
    recalcStyleDurationMs: delta("RecalcStyleDuration") * 1000,
    layoutCount: delta("LayoutCount"),
    recalcStyleCount: delta("RecalcStyleCount"),
    jsHeapUsedMb: (after.JSHeapUsedSize || 0) / (1024 * 1024)
  };
}

function summarize(results) {
  const summary = {};

  for (const scenario of scenarios) {
    const scenarioResults = results.filter(
      (result) => result.scenario === scenario.id
    );
    summary[scenario.id] = {
      cards: median(scenarioResults.map((result) => result.cards)),
      frameMedianMs: median(
        scenarioResults.map((result) => result.frameMetrics.medianMs)
      ),
      frameP95Ms: median(
        scenarioResults.map((result) => result.frameMetrics.p95Ms)
      ),
      frameP99Ms: median(
        scenarioResults.map((result) => result.frameMetrics.p99Ms)
      ),
      framesOver32Ms: median(
        scenarioResults.map((result) => result.frameMetrics.over32Ms)
      ),
      taskUtilizationPercent: median(
        scenarioResults.map(
          (result) => result.browserMetrics.taskUtilizationPercent
        )
      ),
      scriptDurationMs: median(
        scenarioResults.map((result) => result.browserMetrics.scriptDurationMs)
      ),
      layoutDurationMs: median(
        scenarioResults.map((result) => result.browserMetrics.layoutDurationMs)
      ),
      recalcStyleDurationMs: median(
        scenarioResults.map(
          (result) => result.browserMetrics.recalcStyleDurationMs
        )
      ),
      jsHeapUsedMb: median(
        scenarioResults.map((result) => result.browserMetrics.jsHeapUsedMb)
      )
    };
  }

  summary.comparison = {
    stillTaskOverheadPoints:
      summary.still.taskUtilizationPercent -
      summary.disabled.taskUtilizationPercent,
    animatedTaskOverheadPoints:
      summary.animated.taskUtilizationPercent -
      summary.still.taskUtilizationPercent,
    animatedP95OverStillMs:
      summary.animated.frameP95Ms - summary.still.frameP95Ms
  };

  return summary;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) {
    return 0;
  }
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function printResult(result) {
  console.log(
    [
      `[${result.scenario} #${result.run}]`,
      `cards=${result.cards}`,
      `p95=${result.frameMetrics.p95Ms.toFixed(1)}ms`,
      `p99=${result.frameMetrics.p99Ms.toFixed(1)}ms`,
      `>32ms=${result.frameMetrics.over32Ms}`,
      `task=${result.browserMetrics.taskUtilizationPercent.toFixed(1)}%`,
      `heap=${result.browserMetrics.jsHeapUsedMb.toFixed(1)}MB`
    ].join(" ")
  );
}

function printSummary(summary, runDir) {
  console.log("");
  for (const id of ["disabled", "still", "animated"]) {
    const item = summary[id];
    console.log(
      [
        `${id}:`,
        `cards=${item.cards}`,
        `p95=${item.frameP95Ms.toFixed(1)}ms`,
        `p99=${item.frameP99Ms.toFixed(1)}ms`,
        `>32ms=${item.framesOver32Ms}`,
        `task=${item.taskUtilizationPercent.toFixed(1)}%`,
        `heap=${item.jsHeapUsedMb.toFixed(1)}MB`
      ].join(" ")
    );
  }
  console.log(
    `animated vs still: task ${formatSigned(
      summary.comparison.animatedTaskOverheadPoints
    )} points, p95 ${formatSigned(
      summary.comparison.animatedP95OverStillMs
    )}ms`
  );
  console.log(`Report: ${runDir}`);
}

function formatMarkdown(report) {
  const lines = [
    "# Attention Redirector Performance Benchmark",
    "",
    `Run: ${report.runId}`,
    `Slots: ${report.args.slots}`,
    `Runs per scenario: ${report.args.runs}`,
    `Scroll duration: ${report.args.durationMs} ms`,
    `Scroll speed: ${report.args.scrollSpeed} px/s`,
    "",
    "| Scenario | Cards | p95 frame | p99 frame | Frames >32 ms | Task utilization | Heap |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"
  ];

  for (const id of ["disabled", "still", "animated"]) {
    const item = report.summary[id];
    lines.push(
      `| ${id} | ${item.cards} | ${item.frameP95Ms.toFixed(1)} ms | ` +
        `${item.frameP99Ms.toFixed(1)} ms | ${item.framesOver32Ms} | ` +
        `${item.taskUtilizationPercent.toFixed(1)}% | ` +
        `${item.jsHeapUsedMb.toFixed(1)} MB |`
    );
  }

  lines.push(
    "",
    `Animated versus still task overhead: ${formatSigned(
      report.summary.comparison.animatedTaskOverheadPoints
    )} percentage points.`,
    `Animated versus still p95 delta: ${formatSigned(
      report.summary.comparison.animatedP95OverStillMs
    )} ms.`
  );

  return `${lines.join("\n")}\n`;
}

function formatSigned(value) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

function startFixtureServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (request, response) => {
      if (!request.url?.startsWith("/performance-scroll.html")) {
        response.writeHead(404, { "Content-Type": "text/plain" });
        response.end("Not found");
        return;
      }

      try {
        const html = await readFile(fixturePath, "utf8");
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end(html);
      } catch (error) {
        response.writeHead(500, { "Content-Type": "text/plain" });
        response.end(String(error));
      }
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: server.address().port,
        close: () => server.close()
      });
    });
  });
}

async function findServiceWorker(context) {
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker", {
      timeout: 10000
    });
  }
  return serviceWorker;
}

function saveExtensionSettings(serviceWorker, settings) {
  return serviceWorker.evaluate(async (value) => {
    await chrome.storage.local.set({
      attentionRedirectorSettings: value
    });
  }, settings);
}
