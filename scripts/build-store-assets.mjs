import { chromium } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outDir = path.join(projectRoot, "dist/store");

const urlArg = process.argv.indexOf("--url");
const PAGE_URL = urlArg > -1 ? process.argv[urlArg + 1] : "https://www.tomsguide.com/";

const SHOT = { width: 1280, height: 800 };
const TILE = { width: 440, height: 280 };

const SETTINGS = {
  enabled: true,
  anchorNote: "Finish what deserves your attention.",
  anchorNotes: ["Finish what deserves your attention."],
  reducedMotion: "still",
  themePreference: "light",
  disabledDomains: []
};

// Reuses the icon gradient so the tile reads as the same object as the mark.
const TILE_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="440" height="280" viewBox="0 0 440 280">
  <defs>
    <linearGradient id="field" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#d9e4d8"/>
      <stop offset="1" stop-color="#a5bca6"/>
    </linearGradient>
    <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0.4">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.42"/>
      <stop offset="0.55" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="ember" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#d9683a" stop-opacity="0.9"/>
      <stop offset="0.55" stop-color="#d9683a" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#d9683a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="440" height="280" fill="url(#field)"/>
  <path d="M-20 196 C 90 156, 200 232, 470 168 L 470 300 L -20 300 Z"
    fill="#496555" opacity="0.32"/>
  <path d="M-20 224 C 110 188, 240 248, 470 206 L 470 300 L -20 300 Z"
    fill="#2f4a3c" opacity="0.34"/>
  <rect width="440" height="280" fill="url(#sweep)"/>
  <circle cx="352" cy="86" r="70" fill="url(#ember)"/>
  <text x="40" y="120" font-family="Inter, Helvetica Neue, Arial, sans-serif"
    font-size="34" font-weight="600" fill="#22332a">Attention</text>
  <text x="40" y="158" font-family="Inter, Helvetica Neue, Arial, sans-serif"
    font-size="34" font-weight="600" fill="#22332a">Redirector</text>
  <text x="40" y="196" font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
    font-size="14" letter-spacing="1.5" fill="#4a5f52">THE WEB, JUST QUIETER</text>
</svg>
`;

const userDataDir = await mkdtemp(path.join(os.tmpdir(), "attention-redirector-store-"));
await mkdir(outDir, { recursive: true });

let context;
const written = [];

try {
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: SHOT,
    args: [
      `--disable-extensions-except=${projectRoot}`,
      `--load-extension=${projectRoot}`
    ]
  });

  const { extensionId, serviceWorker } = await findExtension(context);
  console.log(`Shooting ${PAGE_URL}`);

  const page = context.pages()[0] || (await context.newPage());
  await page.setViewportSize(SHOT);

  await applySettings(serviceWorker, SETTINGS);
  await loadPage(page, PAGE_URL, { frameLargestCard: true });
  await shoot(page, "screenshot-1-replacement.png");

  // With no note there is nothing to draw, so every detected surface collapses
  // and the page closes over it — the plain-blocker shot.
  await applySettings(serviceWorker, {
    ...SETTINGS,
    anchorNote: "",
    anchorNotes: []
  });
  await loadPage(page, PAGE_URL);
  await shoot(page, "screenshot-2-clean.png");

  await applySettings(serviceWorker, SETTINGS);
  await shootComposed(context, `chrome-extension://${extensionId}/popup.html`, "screenshot-3-popup.png");
  await shootExtensionPage(context, `chrome-extension://${extensionId}/options.html`, "screenshot-4-options.png");
  await shootExtensionPage(context, `chrome-extension://${extensionId}/welcome.html`, "screenshot-5-welcome.png");

  await renderTile(context);

  console.log(`\nWrote ${written.length} assets to dist/store/:`);
  written.forEach((name) => console.log(`  ${name}`));
  console.log("\nReview every shot before upload. Live pages change, so a");
  console.log("capture can land mid-layout or on a consent wall.");
} finally {
  await context?.close();
  await rm(userDataDir, { recursive: true, force: true });
}

async function loadPage(page, url, { frameLargestCard = false } = {}) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.scrollTo(0, 320));
  await page.waitForTimeout(2500);

  if (frameLargestCard) {
    await page.evaluate(() => {
      // First substantial card in document order, kept out of the footer:
      // the absolute largest is often a lazy dead zone far down the page.
      const hit = [...document.querySelectorAll(".attention-redirector-card")]
        .map((card) => ({ rect: card.getBoundingClientRect() }))
        .find(({ rect }) => rect.width >= 200 && rect.height >= 90);
      if (!hit) {
        return;
      }
      const docTop = scrollY + hit.rect.top;
      const maxScroll = document.documentElement.scrollHeight - innerHeight * 1.6;
      const target = docTop - innerHeight * 0.38;
      window.scrollTo(0, Math.max(0, Math.min(target, Math.max(0, maxScroll))));
    });
    await page.waitForTimeout(2000);
  }

  const visible = await page.evaluate(() => {
    return [...document.querySelectorAll(".attention-redirector-card")].filter((card) => {
      const rect = card.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < innerHeight && rect.width > 40 && rect.height > 40;
    }).length;
  });
  console.log(`  in-viewport Tide cards: ${visible}`);
  return visible;
}

async function shoot(page, name) {
  await page.screenshot({ path: path.join(outDir, name) });
  written.push(name);
}

// The popup is ~280px wide, so a raw 1280x800 capture is mostly dead space.
// Shoot it at 2x, then centre it on a branded canvas at the required size.
async function shootComposed(context, url, name) {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 420, height: 900 });
  await panel.goto(url);
  await panel.waitForLoadState("domcontentloaded");
  await panel.waitForTimeout(900);
  const box = await panel.locator("body").boundingBox();
  const shot = await panel.screenshot({
    clip: { x: 0, y: 0, width: Math.ceil(box.width), height: Math.ceil(box.height) }
  });
  await panel.close();

  const stage = await context.newPage();
  await stage.setViewportSize(SHOT);
  await stage.setContent(`
    <body style="margin:0;height:100vh;display:grid;place-items:center;
      background:linear-gradient(140deg,#eef2ec 0%,#d9e4d8 55%,#c4d4c3 100%)">
      <img src="data:image/png;base64,${shot.toString("base64")}"
        style="height:660px;border-radius:14px;
          box-shadow:0 30px 70px rgba(34,51,42,.28),0 4px 12px rgba(34,51,42,.12)">
    </body>
  `);
  await stage.waitForTimeout(500);
  await shoot(stage, name);
  await stage.close();
}

async function shootExtensionPage(context, url, name) {
  const page = await context.newPage();
  await page.setViewportSize(SHOT);
  await page.goto(url);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(900);
  await shoot(page, name);
  await page.close();
}

async function renderTile(context) {
  const page = await context.newPage();
  await page.setViewportSize(TILE);
  await page.setContent(`<body style="margin:0">${TILE_SVG}</body>`);
  await page.waitForTimeout(400);
  const name = "promo-tile-440x280.png";
  await page.screenshot({ path: path.join(outDir, name), clip: { x: 0, y: 0, ...TILE } });
  written.push(name);
  await page.close();
}

// Settings live under one wrapper key; writing them flat silently does nothing.
async function applySettings(serviceWorker, settings) {
  await serviceWorker.evaluate(async (value) => {
    await chrome.storage.local.set({ attentionRedirectorSettings: value });
  }, settings);
}

async function findExtension(context) {
  let [worker] = context.serviceWorkers();
  if (!worker) {
    worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
  }
  return { extensionId: new URL(worker.url()).hostname, serviceWorker: worker };
}
