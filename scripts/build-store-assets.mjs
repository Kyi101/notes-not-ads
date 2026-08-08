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
  themePreference: "light",
  disabledDomains: []
};

// The tile carries the toolbar mark over the ink field, and a card beside it
// holding a real note in the real typeface. The card's own values — surface,
// ink, radius, padding min(w, h) * 0.1, and the leading and tracking the
// replacer.js ramps give at this size — so the tile is the product rather than
// a picture of it. The mark measures 3.00:1 against the ink field, which is a
// floor for a graphic this size and not a text contrast claim.
//
// The mark is icons/icon-128.png rather than a second copy of the crescent
// geometry, so run build:icons before build:store-assets when the mark changes.
//
// setContent has no base URL to resolve fonts against, so neither the font nor
// the mark can be referenced by path; both ship inlined.
const tileHtml = (fontBase64, markBase64) => `
<style>
  @font-face {
    font-family: "Space Grotesk";
    font-weight: 400 700;
    src: url(data:font/woff2;base64,${fontBase64}) format("woff2");
  }
  html, body { margin: 0; }
  .tile {
    display: flex;
    align-items: center;
    gap: 26px;
    box-sizing: border-box;
    width: 440px;
    height: 280px;
    padding: 34px;
    background: #20312a;
    font-family: "Space Grotesk", system-ui, sans-serif;
  }
  .mark {
    display: block;
    width: 46px;
    height: 46px;
    margin: 0 0 18px;
  }
  .wordmark {
    margin: 0;
    color: #e6ebe3;
    font-size: 32px;
    font-weight: 600;
    line-height: 1.08;
    letter-spacing: -0.02em;
  }
  .tagline {
    margin: 14px 0 0;
    color: rgba(230, 235, 227, 0.58);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    letter-spacing: 0.12em;
    white-space: nowrap;
  }
  .card {
    display: flex;
    align-items: center;
    flex: none;
    box-sizing: border-box;
    width: 152px;
    height: 127px;
    padding: 13px;
    border-radius: 12px;
    background: #e6ebe3;
    box-shadow: inset 0 0 0 1px rgba(32, 49, 42, 0.12);
  }
  .card p {
    margin: 0;
    max-width: min(100%, 30em);
    color: #20312a;
    font-size: 18px;
    font-weight: 500;
    line-height: 1.3;
    letter-spacing: -0.012em;
    text-align: left;
  }
</style>
<div class="tile">
  <div>
    <img class="mark" alt="" src="data:image/png;base64,${markBase64}">
    <h1 class="wordmark">Attention<br>Redirector</h1>
    <p class="tagline">THE WEB, JUST QUIETER</p>
  </div>
  <div class="card"><p>${SETTINGS.anchorNotes[0]}</p></div>
</div>`;

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
  // Screenshots must not catch a card mid-fade.
  await page.emulateMedia({ reducedMotion: "reduce" });
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
  console.log(`  in-viewport cards: ${visible}`);
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
  const font = await readFile(
    path.join(projectRoot, "fonts/space-grotesk-latin.woff2")
  );
  const mark = await readFile(path.join(projectRoot, "icons/icon-128.png"));
  const page = await context.newPage();
  await page.setViewportSize(TILE);
  await page.setContent(
    tileHtml(font.toString("base64"), mark.toString("base64"))
  );
  await page.evaluate(() => document.fonts.ready);
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
