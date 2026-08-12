import { chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// EXTENSION_ROOT points this at an unpacked release ZIP; see test-extension.mjs.
const extensionRoot = process.env.EXTENSION_ROOT || path.resolve(__dirname, "..");
const STORAGE_KEY = "attentionRedirectorSettings";

const userDataDir = await mkdtemp(path.join(os.tmpdir(), "attention-redirector-onboarding-"));
let context;

try {
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionRoot}`,
      `--load-extension=${extensionRoot}`
    ]
  });

  const extensionId = await findExtensionId(context);
  const welcomeUrl = `chrome-extension://${extensionId}/welcome.html`;
  const optionsUrl = `chrome-extension://${extensionId}/options.html`;

  // 1. A fresh install must auto-open the welcome tab (onInstalled reason install).
  const autoWelcome = await waitForPage(context, welcomeUrl, 10000);
  if (!autoWelcome) {
    throw new Error("Fresh install did not auto-open welcome.html.");
  }
  await autoWelcome.waitForLoadState("domcontentloaded");

  const consoleErrors = [];
  autoWelcome.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });
  autoWelcome.on("pageerror", (err) => consoleErrors.push(err.message));

  const heading = (await autoWelcome.locator("h1").first().innerText()).trim();
  if (!heading) {
    throw new Error("Welcome page rendered no heading.");
  }
  const ctaCount = await autoWelcome.locator("#openOptions").count();
  if (ctaCount !== 1) {
    throw new Error(`Expected one #openOptions CTA, found ${ctaCount}.`);
  }

  // 2. The CTA must open the options page.
  await autoWelcome.locator("#openOptions").click();
  const optionsPage = await waitForPage(context, optionsUrl, 8000);
  if (!optionsPage) {
    throw new Error("Choose-your-defaults CTA did not open options.html.");
  }
  await optionsPage.close();

  // 3. A saved theme preference must be applied to the welcome document.
  for (const theme of ["dark", "light", "system"]) {
    await setStoredTheme(autoWelcome, theme);
    const themed = await context.newPage();
    await themed.goto(welcomeUrl);
    await themed.waitForLoadState("domcontentloaded");
    await themed
      .locator(`html[data-theme="${theme}"]`)
      .waitFor({ state: "attached", timeout: 3000 })
      .catch(() => {});
    const applied = await themed.evaluate(() => document.documentElement.dataset.theme);
    if (applied !== theme) {
      throw new Error(`Welcome did not apply saved theme "${theme}" (got "${applied}").`);
    }
    await themed.close();
  }

  if (consoleErrors.length > 0) {
    throw new Error(`Welcome page logged errors: ${JSON.stringify(consoleErrors)}`);
  }

  console.log(`onboarding: welcome heading "${heading}"`);
  console.log("onboarding: auto-open on install, CTA to options, and theme apply all pass");
  console.log("PASS onboarding");
} finally {
  if (context) {
    await context.close();
  }
  await rm(userDataDir, { recursive: true, force: true });
}

async function findExtensionId(ctx) {
  let [worker] = ctx.serviceWorkers();
  if (!worker) {
    worker = await ctx.waitForEvent("serviceworker", { timeout: 8000 });
  }
  return new URL(worker.url()).hostname;
}

async function waitForPage(ctx, url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = ctx.pages().find((page) => page.url().startsWith(url));
    if (match) {
      return match;
    }
    try {
      await ctx.waitForEvent("page", { timeout: Math.max(deadline - Date.now(), 0) });
    } catch (_error) {
      break;
    }
  }
  return ctx.pages().find((page) => page.url().startsWith(url)) || null;
}

async function setStoredTheme(page, themePreference) {
  await page.evaluate(
    ({ key, value }) =>
      new Promise((resolve) => {
        chrome.storage.local.set({ [key]: { themePreference: value } }, resolve);
      }),
    { key: STORAGE_KEY, value: themePreference }
  );
}
