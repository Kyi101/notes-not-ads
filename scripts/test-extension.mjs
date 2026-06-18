import { chromium } from "@playwright/test";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const extensionRoot = projectRoot;
const fixturePath = path.join(projectRoot, "tests/fixtures/ad-clutter.html");
const DEFAULT_EXTENSION_SETTINGS = {
  enabled: true,
  mode: "quiet",
  anchorNote: "Finish what deserves your attention.",
  visualPresence: 10,
  reducedMotion: "system",
  disabledDomains: []
};

const server = await startFixtureServer();
const userDataDir = await mkdtemp(path.join(os.tmpdir(), "attention-redirector-"));

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
  page.on("console", msg => console.log("PAGE LOG:", msg.text()));
  page.on("pageerror", err => console.log("PAGE ERROR:", err.message));
  const fixtureUrl = `http://127.0.0.1:${server.port}/ad-clutter.html`;

  await assertDnrBehavior(context, serviceWorker, fixtureUrl);

  await page.goto(fixtureUrl);
  await page.waitForLoadState("domcontentloaded");
  await page
    .locator("#AdThrive_Footer_1_desktop.attention-redirector-slot")
    .waitFor({ timeout: 5000 });
  await page
    .locator("#commerce-showcase.attention-redirector-slot")
    .waitFor({ timeout: 5000 });
  await page
    .locator("#video_53812_ima-ad-container.attention-redirector-slot")
    .waitFor({ timeout: 5000 });
  await page
    .locator("#script-iframe-shell.attention-redirector-slot")
    .waitFor({ timeout: 5000 });
  await page
    .locator("#cosmetic-only-slot.attention-redirector-slot")
    .waitFor({ timeout: 5000 });
  await page
    .locator("#refreshing-top-ad.attention-redirector-slot")
    .waitFor({ timeout: 5000 });
  await page
    .locator("#search-results-ad-shell.attention-redirector-slot")
    .waitFor({ timeout: 5000 });
  await page
    .locator("#floating-video-unit.attention-redirector-slot")
    .waitFor({ timeout: 5000 });
  await page
    .locator("#schulist-bottom-banner.attention-redirector-slot")
    .waitFor({ timeout: 5000 });
  await page
    .locator("#framework-owned-ad.attention-redirector-slot")
    .waitFor({ timeout: 5000 });
  await page
    .locator("#brnd8e78c7f2c.attention-redirector-slot")
    .waitFor({ timeout: 5000 });
  await page
    .locator("#late-injected-ad.attention-redirector-slot")
    .waitFor({ timeout: 5000 });
  const lateReplacementLatency = await page.evaluate(() => {
    return window.__lateAdReplacedAt - window.__lateAdInsertedAt;
  });
  if (
    !Number.isFinite(lateReplacementLatency) ||
    lateReplacementLatency > 350
  ) {
    throw new Error(
      `Late ad replacement took ${lateReplacementLatency}ms; expected <= 350ms.`
    );
  }
  await assertVisuallySuppressed(
    page,
    "#ibrnd8e78c7f2c",
    "Branding takeover iframe"
  );
  await assertVisuallySuppressed(
    page,
    "#commerce-showcase-ad-sidecar",
    "Partial ad sidecar"
  );
  await assertVisuallySuppressed(
    page,
    "#schulist-bottom-banner > img",
    "Schulist fixed banner image"
  );
  await page.waitForTimeout(1400);
  await page
    .locator("#refreshing-top-ad.attention-redirector-slot .attention-redirector-card")
    .waitFor({ timeout: 5000 });
  await assertVisuallySuppressed(
    page,
    "#refreshing-top-ad > strong",
    "Refreshed ad creative"
  );
  await page.waitForFunction(() => {
    return window.__frameworkReconcileStatus;
  });
  const frameworkReconcileStatus = await page.evaluate(() => {
    return window.__frameworkReconcileStatus;
  });
  if (frameworkReconcileStatus !== "removed") {
    throw new Error(
      `Framework-owned child reconciliation failed: ${frameworkReconcileStatus}`
    );
  }
  await page
    .locator(
      "#framework-owned-ad.attention-redirector-slot .attention-redirector-card"
    )
    .waitFor({ timeout: 5000 });

  const quietCards = page.locator(
    ".attention-redirector-card[data-mode='quiet']"
  );
  const quietCardCount = await quietCards.count();
  if (quietCardCount < 3) {
    throw new Error(`Expected at least 3 Quiet cards, found ${quietCardCount}.`);
  }

  const nonTideCardCount = await page
    .locator(
      ".attention-redirector-card:not([data-ambient-variant='tide'])"
    )
    .count();
  if (nonTideCardCount !== 0) {
    throw new Error(
      `Expected Tide-only production cards, found ${nonTideCardCount} non-Tide cards.`
    );
  }

  const compactCardCount = await page
    .locator(".attention-redirector-card--compact")
    .count();
  if (compactCardCount < 1) {
    throw new Error("Ambient cards did not preserve compact slot handling.");
  }

  await saveExtensionSettings(serviceWorker, {
    ...DEFAULT_EXTENSION_SETTINGS,
    mode: "anchor"
  });

  const anchorPage = await context.newPage();
  await anchorPage.goto(`${fixtureUrl}#anchor`);
  await anchorPage.waitForLoadState("domcontentloaded");
  await anchorPage
    .locator(
      "#AdThrive_Footer_1_desktop.attention-redirector-slot .attention-redirector-card[data-mode='anchor']"
    )
    .waitFor({ timeout: 5000 });

  const anchorText = await anchorPage
    .locator(".attention-redirector-card__body")
    .first()
    .innerText();
  if (anchorText !== "Finish what deserves your attention.") {
    throw new Error(`Unexpected Anchor text: ${anchorText}`);
  }
  await anchorPage.close();

  await saveExtensionSettings(serviceWorker, {
    ...DEFAULT_EXTENSION_SETTINGS,
    reducedMotion: "still"
  });

  const reducedMotionPage = await context.newPage();
  await reducedMotionPage.goto(`${fixtureUrl}#reduced-motion`);
  await reducedMotionPage.waitForLoadState("domcontentloaded");
  const reducedMotionCard = reducedMotionPage
    .locator(".attention-redirector-card--still")
    .first();
  await reducedMotionCard.waitFor({ timeout: 5000 });
  const reducedAnimations = await reducedMotionCard.evaluate((element) => {
    return {
      card: getComputedStyle(element).animationName,
      before: getComputedStyle(element, "::before").animationName,
      after: getComputedStyle(element, "::after").animationName
    };
  });
  if (Object.values(reducedAnimations).some((value) => value !== "none")) {
    throw new Error(
      `Reduced motion left animations enabled: ${JSON.stringify(reducedAnimations)}`
    );
  }
  const stillCardCount = await reducedMotionPage
    .locator(".attention-redirector-card--still")
    .count();
  if (stillCardCount < 1) {
    throw new Error("Always-still motion setting did not mark replacement cards.");
  }
  await reducedMotionPage.close();

  await saveExtensionSettings(serviceWorker, {
    ...DEFAULT_EXTENSION_SETTINGS,
    visualPresence: 0
  });
  const cleanPage = await context.newPage();
  await cleanPage.goto(`${fixtureUrl}#clean`);
  await cleanPage.waitForLoadState("domcontentloaded");
  await cleanPage
    .locator(
      "#AdThrive_Footer_1_desktop.attention-redirector-slot[data-attention-redirector-presentation='clean']"
    )
    .waitFor({ state: "attached", timeout: 5000 });
  const cleanCardCount = await cleanPage
    .locator(".attention-redirector-card")
    .count();
  const cleanSlotCount = await cleanPage
    .locator(
      ".attention-redirector-slot[data-attention-redirector-presentation='clean']"
    )
    .count();
  if (cleanCardCount !== 0 || cleanSlotCount < 3) {
    throw new Error(
      `Clean expected hidden slots and no cards; found ${cleanSlotCount} slots and ${cleanCardCount} cards.`
    );
  }
  const visibleCleanSlotCount = await cleanPage
    .locator(
      ".attention-redirector-slot[data-attention-redirector-presentation='clean']:visible"
    )
    .count();
  if (visibleCleanSlotCount !== 0) {
    throw new Error(`Clean left ${visibleCleanSlotCount} detected slots visible.`);
  }
  await cleanPage.close();

  await saveExtensionSettings(serviceWorker, {
    ...DEFAULT_EXTENSION_SETTINGS,
    visualPresence: 5
  });
  const mixedPage = await context.newPage();
  await mixedPage.goto(`${fixtureUrl}#mixed`);
  await mixedPage.waitForLoadState("domcontentloaded");
  await mixedPage
    .locator(".attention-redirector-slot")
    .first()
    .waitFor({ state: "attached", timeout: 5000 });
  await mixedPage.waitForTimeout(500);
  const mixedAmbientCount = await mixedPage
    .locator(
      ".attention-redirector-slot[data-attention-redirector-presentation='ambient']"
    )
    .count();
  const mixedCleanCount = await mixedPage
    .locator(
      ".attention-redirector-slot[data-attention-redirector-presentation='clean']"
    )
    .count();
  if (mixedAmbientCount < 1 || mixedCleanCount < 1) {
    throw new Error(
      `Mixed presence expected both treatments; found ${mixedAmbientCount} ambient and ${mixedCleanCount} clean.`
    );
  }
  const mixedAmbientRatio =
    mixedAmbientCount / (mixedAmbientCount + mixedCleanCount);
  if (Math.abs(mixedAmbientRatio - 0.5) > 0.25) {
    throw new Error(
      `Presence 5 was too skewed: ${mixedAmbientCount} ambient and ${mixedCleanCount} clean.`
    );
  }
  await mixedPage.close();

  await saveExtensionSettings(serviceWorker, {
    ...DEFAULT_EXTENSION_SETTINGS,
    enabled: false
  });
  await page.waitForFunction(() => {
    const slots = Array.from(
      document.querySelectorAll(".attention-redirector-slot")
    );
    return (
      slots.length > 0 &&
      slots.every((slot) => getComputedStyle(slot).display === "none")
    );
  });
  const disabledOpenPageCardCount = await page
    .locator(".attention-redirector-card")
    .count();
  if (disabledOpenPageCardCount !== 0) {
    throw new Error(
      `Disabling the extension left ${disabledOpenPageCardCount} cards on an open page.`
    );
  }
  const disabledPage = await context.newPage();
  await disabledPage.goto(`${fixtureUrl}#disabled`);
  await disabledPage.waitForLoadState("domcontentloaded");
  await disabledPage.waitForTimeout(900);
  const disabledCardCount = await disabledPage
    .locator(".attention-redirector-card")
    .count();
  if (disabledCardCount !== 0) {
    throw new Error(
      `Disabled startup inserted ${disabledCardCount} unexpected cards.`
    );
  }
  await disabledPage.close();

  await saveExtensionSettings(serviceWorker, DEFAULT_EXTENSION_SETTINGS);
  await page
    .locator(".attention-redirector-card[data-mode='quiet']")
    .first()
    .waitFor({ state: "visible", timeout: 5000 });

  await saveExtensionSettings(serviceWorker, {
    enabled: true,
    customNotes: ["Legacy focus"],
    frequency: "max3",
    disabledDomains: []
  });
  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
  await popupPage.locator("#visualPresence").waitFor({ timeout: 5000 });
  const migratedPopup = await popupPage.evaluate(() => {
    return {
      mode: document.querySelector("[data-mode][aria-pressed='true']")?.dataset.mode,
      anchorNote: document.querySelector("#anchorNote")?.value,
      visualPresence: document.querySelector("#visualPresence")?.value
    };
  });
  if (
    migratedPopup.mode !== "anchor" ||
    migratedPopup.anchorNote !== "Legacy focus" ||
    migratedPopup.visualPresence !== "6"
  ) {
    throw new Error(
      `Popup did not migrate legacy settings: ${JSON.stringify(migratedPopup)}`
    );
  }
  await popupPage.locator("[data-mode='anchor']").click();
  await popupPage.locator("#anchorNote").fill("Protect the next hour.");
  await popupPage.locator("#visualPresence").evaluate((element) => {
    element.value = "4";
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await popupPage.waitForTimeout(350);
  const popupSettings = await loadExtensionSettings(serviceWorker);
  if (
    popupSettings.mode !== "anchor" ||
    popupSettings.anchorNote !== "Protect the next hour." ||
    popupSettings.visualPresence !== 4
  ) {
    throw new Error(
      `Popup did not persist controls: ${JSON.stringify(popupSettings)}`
    );
  }
  await popupPage.close();

  const optionsPage = await context.newPage();
  await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
  await optionsPage.locator("#optionsForm").waitFor({ timeout: 5000 });
  await optionsPage.locator("input[name='mode'][value='anchor']").waitFor({
    state: "attached"
  });
  if (await optionsPage.locator("#categoryList, #frequency").count()) {
    throw new Error("Options still exposes retired category or frequency controls.");
  }
  const renderedOptions = await optionsPage.evaluate(() => {
    return {
      mode: document.querySelector("input[name='mode']:checked")?.value,
      anchorNote: document.querySelector("#anchorNote")?.value,
      visualPresence: document.querySelector("#visualPresence")?.value
    };
  });
  if (
    renderedOptions.mode !== "anchor" ||
    renderedOptions.anchorNote !== "Protect the next hour." ||
    renderedOptions.visualPresence !== "4"
  ) {
    throw new Error(
      `Options did not render saved controls: ${JSON.stringify(renderedOptions)}`
    );
  }
  await optionsPage.locator("#reducedMotion").selectOption("still");
  await optionsPage.getByRole("button", { name: "Save settings" }).click();
  await optionsPage.locator("#saveStatus").filter({ hasText: "Saved." }).waitFor();
  const optionsSettings = await loadExtensionSettings(serviceWorker);
  if (optionsSettings.reducedMotion !== "still") {
    throw new Error(
      `Options did not persist motion setting: ${JSON.stringify(optionsSettings)}`
    );
  }
  await optionsPage.close();

  await saveExtensionSettings(serviceWorker, DEFAULT_EXTENSION_SETTINGS);
  await page.goto(fixtureUrl);
  await page.waitForLoadState("domcontentloaded");
  await page
    .locator(
      "#AdThrive_Footer_1_desktop.attention-redirector-slot .attention-redirector-card[data-mode='quiet']"
    )
    .waitFor({ state: "visible", timeout: 5000 });

  const fixtureTabId = await findFixtureTabId(serviceWorker, fixtureUrl);
  await sendExtensionMessage(serviceWorker, fixtureTabId, {
    type: "AR_TOGGLE_INSPECTOR"
  });

  await page.locator(".attention-redirector-inspector").waitFor({
    state: "visible",
    timeout: 5000
  });

  const highlightedCount = await page
    .locator(".attention-redirector-inspector-box")
    .count();

  if (highlightedCount < 1) {
    throw new Error("Inspector opened but did not highlight any candidates.");
  }

  const stickyOfferBox = await findInspectorBoxForElement(page, "#sticky-offer");
  await stickyOfferBox.locator(".attention-redirector-inspector-box__label").click();
  await page
    .locator(".attention-redirector-inspector")
    .getByRole("button", { name: "Save + copy" })
    .click();
  try {
    await page
      .locator("[data-attention-redirector-inspector-copy-status]")
      .filter({ hasText: "Saved + copied" })
      .waitFor({ timeout: 5000 });
  } catch (error) {
    const details = await page
      .locator("[data-attention-redirector-inspector-details]")
      .innerText();
    const status = await page
      .locator("[data-attention-redirector-inspector-copy-status]")
      .innerText();
    throw new Error(
      `Save + copy did not succeed. Status: ${status}. Details: ${details}`,
      { cause: error }
    );
  }

  const savedReports = await loadSavedReports(serviceWorker);
  if (savedReports.length !== 1) {
    throw new Error(`Expected 1 saved report, found ${savedReports.length}.`);
  }
  await page.locator("#sticky-offer").evaluate((element) => {
    element.style.display = "none";
  });
  await page.locator("#floating-video-unit").evaluate((element) => {
    element.style.display = "none";
  });
  await page
    .locator("[data-attention-redirector-saved-count]")
    .filter({ hasText: "Saved: 1" })
    .waitFor({ timeout: 5000 });

  await page
    .locator(".attention-redirector-inspector")
    .getByRole("button", { name: "Manual pick" })
    .click();
  await page.locator("#plain-missed-rectangle").scrollIntoViewIfNeeded();
  const manualBox = await page.locator("#plain-missed-rectangle").boundingBox();
  if (!manualBox) {
    throw new Error("No manual fixture bounding box.");
  }
  await page.mouse.move(
    manualBox.x + manualBox.width / 2,
    manualBox.y + manualBox.height / 2
  );
  await page.mouse.click(
    manualBox.x + manualBox.width / 2,
    manualBox.y + manualBox.height / 2
  );
  try {
    await page
      .locator("[data-attention-redirector-inspector-details]")
      .filter({ hasText: "div#plain-missed-rectangle" })
      .waitFor({ timeout: 5000 });
  } catch (error) {
    const details = await page
      .locator("[data-attention-redirector-inspector-details]")
      .innerText();
    throw new Error(`Manual pick did not select target. Details: ${details}`, {
      cause: error
    });
  }

  await page
    .locator(".attention-redirector-inspector")
    .getByRole("button", { name: "Manual pick" })
    .click();
  await page.locator("#click-through-ad").scrollIntoViewIfNeeded();
  const clickThroughBox = await page.locator("#click-through-ad").boundingBox();
  if (!clickThroughBox) {
    throw new Error("No click-through ad fixture bounding box.");
  }
  await page.mouse.move(
    clickThroughBox.x + clickThroughBox.width / 2,
    clickThroughBox.y + clickThroughBox.height / 2
  );
  await page.mouse.click(
    clickThroughBox.x + clickThroughBox.width / 2,
    clickThroughBox.y + clickThroughBox.height / 2
  );
  if (page.url() !== fixtureUrl) {
    throw new Error(`Manual pick navigated away to ${page.url()}.`);
  }
  try {
    await page
      .locator("[data-attention-redirector-inspector-details]")
      .filter({ hasText: "a#click-through-ad" })
      .waitFor({ timeout: 5000 });
  } catch (error) {
    const details = await page
      .locator("[data-attention-redirector-inspector-details]")
      .innerText();
    throw new Error(
      `Manual pick did not select click-through ad. Details: ${details}`,
      { cause: error }
    );
  }

  console.log("extension id:", extensionId);
  console.log("fixture url:", fixtureUrl);
  console.log("fixture tab id:", fixtureTabId);
  console.log("quiet cards:", quietCardCount);
  console.log("compact cards:", compactCardCount);
  console.log("late replacement latency:", `${Math.round(lateReplacementLatency)}ms`);
  console.log("DNR probe:", "blocked / site-allowed / globally-disabled");
  console.log("framework reconciliation:", frameworkReconcileStatus);
  console.log("anchor text:", anchorText);
  console.log("reduced motion:", reducedAnimations);
  console.log("clean slots:", cleanSlotCount);
  console.log(
    "mixed presence:",
    `${mixedAmbientCount} ambient / ${mixedCleanCount} clean`
  );
  console.log("disabled open-page cards:", disabledOpenPageCardCount);
  console.log("disabled startup cards:", disabledCardCount);
  console.log("popup settings:", popupSettings);
  console.log("options settings:", optionsSettings);
  console.log("highlighted candidates:", highlightedCount);
  console.log("saved reports:", savedReports.length);
  console.log("PASS inspector smoke");
} finally {
  if (context) {
    await context.close();
  }
  server.close();
  await rm(userDataDir, { recursive: true, force: true });
}

function startFixtureServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (request, response) => {
      const url = new URL(request.url || "/", "http://127.0.0.1");

      if (url.pathname === "/attention-redirector-dnr-probe.js") {
        response.writeHead(200, {
          "Content-Type": "application/javascript",
          "Cache-Control": "no-store"
        });
        response.end("window.__attentionRedirectorDnrProbeLoaded = true;");
        return;
      }

      if (!url.pathname.endsWith("/ad-clutter.html")) {
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
      const address = server.address();
      resolve({
        port: address.port,
        close: () => server.close()
      });
    });
  });
}

async function assertDnrBehavior(context, serviceWorker, fixtureUrl) {
  if (!serviceWorker) {
    throw new Error("No extension service worker available for DNR checks.");
  }

  await saveExtensionSettings(serviceWorker, DEFAULT_EXTENSION_SETTINGS);
  await waitForEnabledRulesets(serviceWorker, true);

  const blockedPage = await context.newPage();
  await blockedPage.goto(`${fixtureUrl}#dnr-block`);
  const blockedProbe = await loadDnrProbeScript(blockedPage);
  await blockedPage.close();
  if (blockedProbe.loaded) {
    throw new Error(
      `DNR probe loaded while network rules were enabled: ${JSON.stringify(blockedProbe)}`
    );
  }

  const fixtureOrigin = new URL(fixtureUrl).origin;
  const sensitivePage = await context.newPage();
  await sensitivePage.goto(`${fixtureOrigin}/checkout/ad-clutter.html#dnr-sensitive`);
  const sensitiveTabId = await findTabIdForUrl(serviceWorker, sensitivePage.url());
  await waitForDnrTabAllow(serviceWorker, sensitiveTabId);
  const sensitiveProbe = await loadDnrProbeScript(sensitivePage);
  await sensitivePage.close();
  if (!sensitiveProbe.loaded) {
    throw new Error(
      `DNR probe stayed blocked on a sensitive path: ${JSON.stringify(sensitiveProbe)}`
    );
  }

  await saveExtensionSettings(serviceWorker, {
    ...DEFAULT_EXTENSION_SETTINGS,
    disabledDomains: ["127.0.0.1"]
  });
  await waitForDnrAllowDomain(serviceWorker, "127.0.0.1");

  const siteAllowedPage = await context.newPage();
  await siteAllowedPage.goto(`${fixtureUrl}#dnr-site-off`);
  const siteAllowedProbe = await loadDnrProbeScript(siteAllowedPage);
  await siteAllowedPage.close();
  if (!siteAllowedProbe.loaded) {
    throw new Error(
      `DNR probe stayed blocked for a disabled site: ${JSON.stringify(siteAllowedProbe)}`
    );
  }

  await saveExtensionSettings(serviceWorker, {
    ...DEFAULT_EXTENSION_SETTINGS,
    enabled: false
  });
  await waitForEnabledRulesets(serviceWorker, false);
  await waitForNoDnrAllowRules(serviceWorker);

  const globalOffPage = await context.newPage();
  await globalOffPage.goto(`${fixtureUrl}#dnr-global-off`);
  const globalOffProbe = await loadDnrProbeScript(globalOffPage);
  await globalOffPage.close();
  if (!globalOffProbe.loaded) {
    throw new Error(
      `DNR probe stayed blocked while extension was globally disabled: ${JSON.stringify(globalOffProbe)}`
    );
  }

  await saveExtensionSettings(serviceWorker, DEFAULT_EXTENSION_SETTINGS);
  await waitForEnabledRulesets(serviceWorker, true);
}

async function loadDnrProbeScript(page) {
  return page.evaluate(() => {
    return new Promise((resolve) => {
      delete window.__attentionRedirectorDnrProbeLoaded;
      const script = document.createElement("script");
      script.src = `/attention-redirector-dnr-probe.js?cache=${Date.now()}`;
      let done = false;

      const finish = (eventName) => {
        if (done) {
          return;
        }
        done = true;
        resolve({
          eventName,
          loaded: window.__attentionRedirectorDnrProbeLoaded === true
        });
      };

      script.addEventListener("load", () => finish("load"));
      script.addEventListener("error", () => finish("error"));
      document.head.append(script);
      window.setTimeout(() => finish("timeout"), 1500);
    });
  });
}

async function waitForEnabledRulesets(serviceWorker, expectedEnabled) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const enabledRulesets = await serviceWorker.evaluate(async () => {
      return chrome.declarativeNetRequest.getEnabledRulesets();
    });
    const enabled = new Set(enabledRulesets);
    const matches = expectedEnabled
      ? enabled.has("ruleset_1") && enabled.has("easylist")
      : !enabled.has("ruleset_1") && !enabled.has("easylist");
    if (matches) {
      return;
    }
    await delay(100);
  }

  throw new Error(
    `Timed out waiting for DNR rulesets to be ${expectedEnabled ? "enabled" : "disabled"}.`
  );
}

async function waitForDnrAllowDomain(serviceWorker, domain) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const found = await serviceWorker.evaluate(async (targetDomain) => {
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      return rules.some((rule) => {
        return (
          rule.id >= 900000 &&
          rule.action?.type === "allow" &&
          Array.isArray(rule.condition?.initiatorDomains) &&
          rule.condition.initiatorDomains.includes(targetDomain)
        );
      });
    }, domain);
    if (found) {
      return;
    }
    await delay(100);
  }

  throw new Error(`Timed out waiting for DNR allow rule for ${domain}.`);
}

async function waitForDnrTabAllow(serviceWorker, tabId) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const found = await serviceWorker.evaluate(async (targetTabId) => {
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      return rules.some((rule) => {
        return (
          rule.id >= 910000 &&
          rule.action?.type === "allow" &&
          Array.isArray(rule.condition?.tabIds) &&
          rule.condition.tabIds.includes(targetTabId)
        );
      });
    }, tabId);
    if (found) {
      return;
    }
    await delay(100);
  }

  throw new Error(`Timed out waiting for DNR tab allow rule for tab ${tabId}.`);
}

async function waitForNoDnrAllowRules(serviceWorker) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const count = await serviceWorker.evaluate(async () => {
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      return rules.filter((rule) => rule.id >= 900000).length;
    });
    if (count === 0) {
      return;
    }
    await delay(100);
  }

  throw new Error("Timed out waiting for DNR allow rules to clear.");
}

async function findTabIdForUrl(serviceWorker, pageUrl) {
  const tabs = await serviceWorker.evaluate(async () => {
    return chrome.tabs.query({});
  });
  const withoutHash = String(pageUrl).split("#")[0];

  const exactMatch = tabs.find((tab) => {
    return tab.url === pageUrl || String(tab.url || "").split("#")[0] === withoutHash;
  });
  if (exactMatch && exactMatch.id) {
    return exactMatch.id;
  }

  throw new Error(
    `Could not find tab id for ${pageUrl}. Visible tabs: ${JSON.stringify(tabs)}`
  );
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

  const browser = context.browser();
  if (!browser) {
    throw new Error("No browser handle available.");
  }

  const page = await context.newPage();
  page.on("console", msg => console.log("PAGE LOG:", msg.text()));
  page.on("pageerror", err => console.log("PAGE ERROR:", err.message));
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

async function findFixtureTabId(serviceWorker, fixtureUrl) {
  if (!serviceWorker) {
    throw new Error("No extension service worker available for tab lookup.");
  }

  const tabs = await serviceWorker.evaluate(async () => {
    return chrome.tabs.query({});
  });

  const exactMatch = tabs.find((tab) => tab.url === fixtureUrl);
  if (exactMatch && exactMatch.id) {
    return exactMatch.id;
  }

  const normalTabs = tabs.filter((tab) => {
    return typeof tab.url === "string" && /^https?:\/\//.test(tab.url);
  });

  if (normalTabs.length === 1 && normalTabs[0].id) {
    return normalTabs[0].id;
  }

  const activeTabs = tabs.filter((tab) => tab.active && tab.id);
  if (activeTabs.length === 1) {
    return activeTabs[0].id;
  }

  throw new Error(
    `Could not find fixture tab id. Visible tabs: ${JSON.stringify(tabs)}`
  );
}

async function sendExtensionMessage(serviceWorker, tabId, message) {
  return serviceWorker.evaluate(
    async ({ targetTabId, payload }) => {
      return chrome.tabs.sendMessage(targetTabId, payload);
    },
    { targetTabId: tabId, payload: message }
  );
}

async function loadSavedReports(serviceWorker) {
  return serviceWorker.evaluate(async () => {
    const result = await chrome.storage.local.get(
      "attentionRedirectorInspectorReports"
    );
    return result.attentionRedirectorInspectorReports || [];
  });
}

async function saveExtensionSettings(serviceWorker, settings) {
  return serviceWorker.evaluate(async (value) => {
    await chrome.storage.local.set({
      attentionRedirectorSettings: value
    });
  }, settings);
}

async function loadExtensionSettings(serviceWorker) {
  return serviceWorker.evaluate(async () => {
    const result = await chrome.storage.local.get("attentionRedirectorSettings");
    return result.attentionRedirectorSettings || {};
  });
}

async function findInspectorBoxForElement(page, selector) {
  const elementBox = await page.locator(selector).boundingBox();
  if (!elementBox) {
    throw new Error(`No bounding box for ${selector}.`);
  }

  const boxes = await page.locator(".attention-redirector-inspector-box").all();

  for (const box of boxes) {
    const outlineBox = await box.boundingBox();
    if (!outlineBox) {
      continue;
    }

    const closeEnough =
      Math.abs(outlineBox.x - elementBox.x) <= 4 &&
      Math.abs(outlineBox.y - elementBox.y) <= 4 &&
      Math.abs(outlineBox.width - elementBox.width) <= 8 &&
      Math.abs(outlineBox.height - elementBox.height) <= 8;

    if (closeEnough) {
      return box;
    }
  }

  throw new Error(`No inspector box matched ${selector}.`);
}

async function assertVisuallySuppressed(page, selector, label) {
  const elements = page.locator(selector);
  const count = await elements.count();
  if (count < 1) {
    throw new Error(`${label} was not preserved for the suppression check.`);
  }

  const unsuppressed = await elements.evaluateAll((nodes) => {
    return nodes.filter((node) => {
      let current = node;
      let visuallyHidden = false;
      let interactionBlocked = false;

      while (current instanceof HTMLElement) {
        const style = getComputedStyle(current);
        visuallyHidden ||= Number.parseFloat(style.opacity || "1") === 0;
        interactionBlocked ||= style.pointerEvents === "none";
        if (current.classList.contains("attention-redirector-slot")) {
          break;
        }
        current = current.parentElement;
      }

      return !visuallyHidden || !interactionBlocked;
    }).length;
  });

  if (unsuppressed > 0) {
    throw new Error(`${label} remained visually or interactively active.`);
  }
}
