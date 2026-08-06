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
  anchorNotes: ["Finish what deserves your attention."],
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
  await assertLinkedinAppBypass(context, serviceWorker);
  await assertYoutubePruneBehavior(context, serviceWorker);

  await page.goto(fixtureUrl);
  await page.waitForLoadState("domcontentloaded");
  await page
    .locator("#AdThrive_Footer_1_desktop.attention-redirector-slot")
    .waitFor({ state: "attached", timeout: 5000 });
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
    .locator("#search-affiliate-ad.attention-redirector-slot")
    .waitFor({ timeout: 5000 });
  await page
    .locator("#oversized-domain-cosmetic-ad.attention-redirector-slot")
    .waitFor({ state: "attached", timeout: 5000 });
  const oversizedCosmeticState = await page.evaluate(() => {
    const slot = document.getElementById("oversized-domain-cosmetic-ad");
    const rect = slot?.getBoundingClientRect();
    const style = slot ? getComputedStyle(slot) : null;
    return {
      presentation: slot?.dataset.attentionRedirectorPresentation || "",
      collapse: slot?.dataset.attentionRedirectorCollapse || "",
      cards: slot?.querySelectorAll(".attention-redirector-card").length ?? -1,
      display: style?.display || "",
      height: rect?.height ?? -1
    };
  });
  if (
    oversizedCosmeticState.presentation !== "clean" ||
    oversizedCosmeticState.collapse !== "oversized-cosmetic" ||
    oversizedCosmeticState.cards !== 0 ||
    oversizedCosmeticState.display !== "none" ||
    oversizedCosmeticState.height !== 0
  ) {
    throw new Error(
      `Oversized domain cosmetic ad was not collapsed like a blocker rule: ${JSON.stringify(oversizedCosmeticState)}`
    );
  }
  try {
    await page.waitForFunction(() => {
      const root = document.querySelector("#shadow-ad-widget")?.shadowRoot;
      return Boolean(
        root?.querySelector(
          "#shadow-ad-slot.attention-redirector-slot .attention-redirector-card"
        )
      );
    });
  } catch (error) {
    const shadowDiagnosticTabId = await findFixtureTabId(serviceWorker, fixtureUrl);
    await sendExtensionMessage(serviceWorker, shadowDiagnosticTabId, {
      type: "AR_REPLACE_NOW"
    });
    await page.waitForTimeout(500);
    const shadowState = await page.evaluate(() => {
      const host = document.querySelector("#shadow-ad-widget");
      const root = host?.shadowRoot;
      const slot = root?.querySelector("#shadow-ad-slot");
      const card = root?.querySelector(
        "#shadow-ad-slot.attention-redirector-slot .attention-redirector-card"
      );
      const rect = slot?.getBoundingClientRect();
      return {
        hasHost: Boolean(host),
        hasRoot: Boolean(root),
        forceRescanReplaced: Boolean(card),
        slotClass: slot?.className || "",
        slotReason: slot?.dataset.attentionRedirectorReason || "",
        slotBlocked: slot?.dataset.attentionRedirectorReplaceBlocked || "",
        slotReplaced: slot?.dataset.attentionRedirectorReplaced || "",
        slotRect: rect
          ? {
              width: rect.width,
              height: rect.height,
              top: rect.top,
              left: rect.left
            }
          : null,
        rootElementCount: root?.querySelectorAll("*").length || 0,
        rootHtml: root?.innerHTML.slice(0, 500) || ""
      };
    });
    throw new Error(
      `Shadow DOM static ad was not replaced: ${JSON.stringify(shadowState)}`,
      { cause: error }
    );
  }
  const shadowCardDisplay = await page.evaluate(() => {
    const root = document.querySelector("#shadow-ad-widget")?.shadowRoot;
    const card = root?.querySelector(
      "#shadow-ad-slot.attention-redirector-slot .attention-redirector-card"
    );
    return card ? getComputedStyle(card).display : "";
  });
  if (shadowCardDisplay !== "flex") {
    throw new Error(`Shadow DOM replacement card was not styled: ${shadowCardDisplay}.`);
  }
  await page
    .locator("#portal-gpt-placeholder.attention-redirector-slot")
    .waitFor({ timeout: 5000 });
  const initialFixtureTabId = await findFixtureTabId(serviceWorker, fixtureUrl);
  await sendExtensionMessage(serviceWorker, initialFixtureTabId, {
    type: "AR_REPLACE_NOW"
  });
  if (await page.locator("#portal-rail.attention-redirector-slot").count()) {
    throw new Error("Portal rail was replaced instead of its child ad slot.");
  }
  if (await page.locator("#portal-fixed-block.attention-redirector-slot").count()) {
    throw new Error("Mixed fixed portal rail was replaced instead of its child ad.");
  }
  await page
    .locator("#partner-story-card.attention-redirector-slot")
    .waitFor({ timeout: 5000 });
  const falsePositiveBaits = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("[id^='fp-'],[id^='cite_note-']"))
      .filter((element) => {
        return (
          element.classList.contains("attention-redirector-slot") ||
          element.dataset.attentionRedirectorReplaced === "true"
        );
      })
      .map((element) => `#${element.id}`);
  });
  if (falsePositiveBaits.length) {
    throw new Error(
      `Editorial bait elements were replaced: ${falsePositiveBaits.join(", ")}.`
    );
  }
  // A replaced image is swapped out for a wrapper, so it leaves the DOM
  // entirely and the bait sweep above cannot see it go.
  if (!(await page.locator("#fp-hero-image").count())) {
    throw new Error("An article hero image was replaced by a card.");
  }
  const ambientSurvivors = await findCaptionSurvivors(page);
  if (ambientSurvivors.length) {
    throw new Error(
      `Full Ambient left ad captions readable: ${ambientSurvivors.join(", ")}.`
    );
  }
  await page
    .locator("#portal-fixed-media-child.attention-redirector-slot")
    .waitFor({ timeout: 5000 });
  await page
    .locator("[data-fixture='linked-media-ad'].attention-redirector-slot")
    .waitFor({ timeout: 5000 });
  await page
    .locator("#refreshing-top-ad.attention-redirector-slot")
    .waitFor({ timeout: 5000 });
  await page
    .locator("#search-results-ad-shell.attention-redirector-slot")
    .waitFor({ timeout: 5000 });
  await page
    .locator("#floating-video-unit.attention-redirector-slot")
    .waitFor({ state: "attached", timeout: 5000 });
  await page
    .locator("#schulist-bottom-banner.attention-redirector-slot")
    .waitFor({ state: "attached", timeout: 5000 });
  await page
    .locator("#framework-owned-ad.attention-redirector-slot")
    .waitFor({ timeout: 5000 });
  await page
    .locator("#caption-paragraph-slot.attention-redirector-slot")
    .waitFor({ timeout: 5000 });
  await page
    .locator("#caption-link-slot.attention-redirector-slot")
    .waitFor({ timeout: 5000 });
  // The module, not the wrapper inside it. The wrapper is what carries the ad's
  // identifiers, but it collapsed when the creative was blocked; the module is
  // what the reader can still see.
  await page
    .locator("#residue-module.attention-redirector-slot")
    .waitFor({ timeout: 5000 });
  await page
    .locator("#residue-module-bare.attention-redirector-slot")
    .waitFor({ timeout: 5000 });
  await page
    .locator("#brnd8e78c7f2c.attention-redirector-slot")
    .waitFor({ state: "attached", timeout: 5000 });
  await page
    .locator("#late-injected-ad.attention-redirector-slot")
    .waitFor({ timeout: 5000 });
  await page
    .locator("#late-domain-cosmetic-ad.attention-redirector-slot")
    .waitFor({ timeout: 5000 });
  await page.waitForFunction(() => {
    const root = document.querySelector("#shadow-ad-widget")?.shadowRoot;
    return Boolean(
      root?.querySelector(
        "#late-shadow-ad.attention-redirector-slot .attention-redirector-card"
      )
    );
  });
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
  const lateDomainCosmeticLatency = await page.evaluate(() => {
    return (
      window.__lateDomainCosmeticReplacedAt -
      window.__lateDomainCosmeticInsertedAt
    );
  });
  if (
    !Number.isFinite(lateDomainCosmeticLatency) ||
    lateDomainCosmeticLatency > 350
  ) {
    throw new Error(
      `Late domain cosmetic replacement took ${lateDomainCosmeticLatency}ms; expected <= 350ms.`
    );
  }
  const lateShadowReplacementLatency = await page.evaluate(() => {
    return window.__lateShadowAdReplacedAt - window.__lateShadowAdInsertedAt;
  });
  if (
    !Number.isFinite(lateShadowReplacementLatency) ||
    lateShadowReplacementLatency > 350
  ) {
    throw new Error(
      `Late shadow ad replacement took ${lateShadowReplacementLatency}ms; expected <= 350ms.`
    );
  }
  await assertVisuallySuppressed(
    page,
    "#ibrnd8e78c7f2c",
    "Branding takeover iframe"
  );
  // A viewport takeover must be hidden, never replaced with a
  // viewport-covering Tide card that blocks the page itself.
  await page.waitForFunction(() => {
    const slot = document.getElementById("brnd8e78c7f2c");
    return slot?.dataset.attentionRedirectorPresentation === "clean";
  }, undefined, { timeout: 5000 });
  const takeoverState = await page.evaluate(() => {
    const slot = document.getElementById("brnd8e78c7f2c");
    const rect = slot?.getBoundingClientRect();
    const style = slot ? getComputedStyle(slot) : null;
    return {
      presentation: slot?.dataset.attentionRedirectorPresentation,
      cards: slot?.querySelectorAll(".attention-redirector-card").length,
      display: style?.display || "",
      visibility: style?.visibility || "",
      height: rect?.height || 0
    };
  });
  if (
    takeoverState.presentation !== "clean" ||
    takeoverState.cards !== 0 ||
    takeoverState.display !== "none" ||
    takeoverState.height !== 0
  ) {
    throw new Error(
      `Branding takeover was not collapsed like a blocker rule: ${JSON.stringify(takeoverState)}`
    );
  }
  // Fixed-position overlay ads follow the same contract: hidden, never carded.
  for (const overlayId of [
    "AdThrive_Footer_1_desktop",
    "floating-video-unit",
    "schulist-bottom-banner"
  ]) {
    const overlayState = await page.evaluate((id) => {
      const slot = document.getElementById(id);
      const rect = slot?.getBoundingClientRect();
      const style = slot ? getComputedStyle(slot) : null;
      return {
        id,
        presentation: slot?.dataset.attentionRedirectorPresentation,
        cards: slot?.querySelectorAll(".attention-redirector-card").length,
        display: style?.display || "",
        visibility: style?.visibility || "",
        height: rect?.height || 0
      };
    }, overlayId);
    if (
      overlayState.presentation !== "clean" ||
      overlayState.cards !== 0 ||
      overlayState.display !== "none" ||
      overlayState.height !== 0
    ) {
      throw new Error(
        `Fixed overlay ad was not collapsed like a blocker rule: ${JSON.stringify(overlayState)}`
      );
    }
  }
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

  // Both attributes decide how the card draws — the tone picks the surface it
  // sits on, the length picks centred against left. A card missing either one
  // renders, so nothing else here would notice.
  const unconfiguredCardCount = await page
    .locator(
      ".attention-redirector-card:not([data-host-tone='light']):not([data-host-tone='dark'])," +
        ".attention-redirector-card:not([data-note-length])"
    )
    .count();
  if (unconfiguredCardCount !== 0) {
    throw new Error(
      `Expected every card to carry a host tone and note length, found ${unconfiguredCardCount} without.`
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
    mode: "anchor",
    anchorNotes: [
      "Finish what deserves your attention.",
      "Protect the next hour.",
      "Return to the work that matters."
    ]
  });

  const anchorPage = await context.newPage();
  await anchorPage.goto(`${fixtureUrl}#anchor`);
  await anchorPage.waitForLoadState("domcontentloaded");
  await anchorPage
    .locator(
      "#top-ad.attention-redirector-slot .attention-redirector-card[data-mode='anchor']"
    )
    .waitFor({ timeout: 5000 });

  const anchorTexts = await anchorPage
    .locator(".attention-redirector-card__body")
    .evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()));
  const expectedAnchorTexts = new Set([
    "Finish what deserves your attention.",
    "Protect the next hour.",
    "Return to the work that matters."
  ]);
  if (
    anchorTexts.length < 1 ||
    anchorTexts.some((text) => !expectedAnchorTexts.has(text))
  ) {
    throw new Error(`Unexpected Anchor texts: ${JSON.stringify(anchorTexts)}`);
  }
  if (new Set(anchorTexts).size < 2) {
    throw new Error(
      `Anchor messages did not rotate across fixture surfaces: ${JSON.stringify(anchorTexts)}`
    );
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
  // Clean now collapses detected slots out of flow (display:none) so the page
  // reflows like an ad blocker, instead of leaving a reserved hidden box.
  const uncollapsedCleanSlots = await cleanPage
    .locator(
      ".attention-redirector-slot[data-attention-redirector-presentation='clean']"
    )
    .evaluateAll((slots) => {
      return slots.filter((slot) => {
        return getComputedStyle(slot).display !== "none";
      }).length;
    });
  if (uncollapsedCleanSlots !== 0) {
    throw new Error(
      `Clean left ${uncollapsedCleanSlots} detected slots in flow.`
    );
  }
  await cleanPage.waitForFunction(() => {
    const root = document.querySelector("#shadow-ad-widget")?.shadowRoot;
    return Boolean(
      root?.querySelector(
        "#shadow-ad-slot.attention-redirector-slot[data-attention-redirector-presentation='clean']"
      )
    );
  });
  const cleanShadowState = await cleanPage.evaluate(() => {
    const root = document.querySelector("#shadow-ad-widget")?.shadowRoot;
    const slot = root?.querySelector("#shadow-ad-slot.attention-redirector-slot");
    if (!slot) {
      return null;
    }
    const style = getComputedStyle(slot);
    return { display: style.display };
  });
  if (!cleanShadowState || cleanShadowState.display !== "none") {
    throw new Error(
      `Clean shadow slot did not collapse: ${JSON.stringify(cleanShadowState)}`
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
  const cleanSurvivors = await findCaptionSurvivors(cleanPage);
  if (cleanSurvivors.length) {
    throw new Error(
      `Clean left ad captions readable: ${cleanSurvivors.join(", ")}.`
    );
  }
  // The caption going quiet is only half of it: a wrapper that reserved height
  // for the creative leaves a blank box where the ad was.
  const cleanGaps = await cleanPage.evaluate(() =>
    [
      "labelled-reserved-wrapper",
      "labelled-reserved-trailing",
      // The two our own blocker creates: the creative never paints, the wrapper
      // collapses under the scanner's height floor, and the module above it goes
      // on holding the space.
      "residue-module",
      "residue-module-bare"
    ]
      .map((id) => ({
        id,
        height: Math.round(
          document.getElementById(id)?.getBoundingClientRect().height ?? -1
        )
      }))
      .filter((entry) => entry.height > 0)
  );
  if (cleanGaps.length) {
    throw new Error(
      `Clean left reserved gaps: ${cleanGaps
        .map((gap) => `#${gap.id} ${gap.height}px`)
        .join(", ")}.`
    );
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
  if (Math.abs(mixedAmbientRatio - 0.5) > 0.3) {
    throw new Error(
      `Presence 5 was too skewed: ${mixedAmbientCount} ambient and ${mixedCleanCount} clean.`
    );
  }
  const mixedSurvivors = await findCaptionSurvivors(mixedPage);
  if (mixedSurvivors.length) {
    throw new Error(
      `Balanced left ad captions readable: ${mixedSurvivors.join(", ")}.`
    );
  }
  await mixedPage.close();

  // Every other pass runs at whatever width the browser window happens to be,
  // which is always wide. Half a screen is a normal way to read, and the size
  // predicates are all width-sensitive: text grows taller as it wraps, and
  // overlay ads that size themselves off the viewport shrink.
  await saveExtensionSettings(serviceWorker, DEFAULT_EXTENSION_SETTINGS);
  const narrowPage = await context.newPage();
  await narrowPage.setViewportSize({ width: 600, height: 900 });
  await narrowPage.goto(`${fixtureUrl}#narrow`);
  await narrowPage.waitForLoadState("domcontentloaded");
  await narrowPage
    .locator(".attention-redirector-slot")
    .first()
    .waitFor({ state: "attached", timeout: 5000 });
  await narrowPage.waitForTimeout(1200);
  // A citation naming an advertising trade magazine carries an ad token in its
  // id and stays under the height floor until the sentence wraps onto a third
  // line, which is why no wide pass could see it.
  const narrowProse = await narrowPage
    .locator("#cite_note-Advertising_Age-9[data-attention-redirector-reason]")
    .count();
  if (narrowProse !== 0) {
    throw new Error("A narrow viewport turned a citation into a slot.");
  }
  // The other direction: an overlay pinned across the viewport is 38px tall at
  // this width and must still be claimed.
  await narrowPage
    .locator("#schulist-bottom-banner.attention-redirector-slot")
    .waitFor({ state: "attached", timeout: 5000 });
  const narrowSurvivors = await findCaptionSurvivors(narrowPage);
  if (narrowSurvivors.length) {
    throw new Error(
      `A narrow viewport left ad captions readable: ${narrowSurvivors.join(", ")}.`
    );
  }
  await narrowPage.close();

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
      slots.every((slot) => {
        const style = getComputedStyle(slot);
        const isOverlay =
          slot.dataset.attentionRedirectorReason ===
            "full-page branding takeover" ||
          slot.dataset.attentionRedirectorOverlay === "true";
        const isCollapsedClean =
          isOverlay ||
          slot.dataset.attentionRedirectorCollapse === "oversized-cosmetic";
        return isCollapsedClean
          ? style.display === "none"
          : style.display !== "none" && style.visibility === "hidden";
      })
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
  await popupPage.locator("#presenceModes").waitFor({ timeout: 5000 });
  await popupPage.locator("#anchorNote").waitFor({ timeout: 5000 });
  const migratedPopup = await popupPage.evaluate(() => {
    return {
      mode: document.querySelector("[data-mode][aria-pressed='true']")?.dataset.mode,
      anchorNote: document.querySelector("#anchorNote")?.value,
      presence: document.querySelector("[data-presence][aria-pressed='true']")
        ?.dataset.presence
    };
  });
  if (
    migratedPopup.mode !== "anchor" ||
    migratedPopup.anchorNote !== "Legacy focus" ||
    migratedPopup.presence !== "balanced"
  ) {
    throw new Error(
      `Popup did not migrate legacy settings: ${JSON.stringify(migratedPopup)}`
    );
  }
  await popupPage.locator("[data-mode='anchor']").click();
  // Type across the debounced-save boundary with a trailing space to catch
  // the caret-stealing regression where saves rewrote the input mid-word.
  const popupNoteInput = popupPage.locator("#anchorNote");
  await popupNoteInput.fill("");
  await popupNoteInput.pressSequentially("Protect ");
  await popupPage.waitForTimeout(400);
  await popupNoteInput.pressSequentially("the next hour.");
  const popupNoteValue = await popupNoteInput.inputValue();
  if (popupNoteValue !== "Protect the next hour.") {
    throw new Error(
      `Popup note input lost text across debounced saves: ${JSON.stringify(popupNoteValue)}`
    );
  }
  await popupPage.locator("[data-presence='clean']").click();
  await popupPage.waitForTimeout(350);
  const popupSettings = await loadExtensionSettings(serviceWorker);
  if (
    popupSettings.mode !== "anchor" ||
    popupSettings.anchorNote !== "Protect the next hour." ||
    popupSettings.anchorNotes?.[0] !== "Protect the next hour." ||
    popupSettings.visualPresence !== 0
  ) {
    throw new Error(
      `Popup did not persist controls: ${JSON.stringify(popupSettings)}`
    );
  }

  const pagesBeforeAdd = context.pages().length;
  await popupPage.locator("#addAnchorMessage").click();
  const secondNoteInput = popupPage.locator("#anchorNotes input").nth(1);
  await secondNoteInput.waitFor({ timeout: 5000 });
  await secondNoteInput.pressSequentially("Second popup note.");
  await popupPage.waitForTimeout(350);
  if (context.pages().length !== pagesBeforeAdd) {
    throw new Error("Popup add-note button opened a new page instead of an inline input.");
  }
  const popupNotesSettings = await loadExtensionSettings(serviceWorker);
  if (
    popupNotesSettings.anchorNotes?.length !== 2 ||
    popupNotesSettings.anchorNotes?.[0] !== "Protect the next hour." ||
    popupNotesSettings.anchorNotes?.[1] !== "Second popup note."
  ) {
    throw new Error(
      `Popup add-note flow did not persist: ${JSON.stringify(popupNotesSettings.anchorNotes)}`
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
      anchorNotes: Array.from(
        document.querySelectorAll(".anchor-message-input")
      ).map((input) => input.value),
      visualPresence: document.querySelector(
        "input[name='visualPresence']:checked"
      )?.value
    };
  });
  if (
    renderedOptions.mode !== "anchor" ||
    renderedOptions.anchorNotes[0] !== "Protect the next hour." ||
    renderedOptions.visualPresence !== "0"
  ) {
    throw new Error(
      `Options did not render saved controls: ${JSON.stringify(renderedOptions)}`
    );
  }
  await optionsPage.locator("#addAnchorMessage").click();
  await optionsPage
    .locator(".anchor-message-input")
    .nth(1)
    .fill("Return to the work that matters.");
  await optionsPage.locator("#reducedMotion").selectOption("still");
  await optionsPage.getByRole("button", { name: "Save settings" }).click();
  await optionsPage.locator("#saveStatus").filter({ hasText: "Saved." }).waitFor();
  const optionsSettings = await loadExtensionSettings(serviceWorker);
  if (
    optionsSettings.reducedMotion !== "still" ||
    optionsSettings.anchorNotes?.[0] !== "Protect the next hour." ||
    optionsSettings.anchorNotes?.[1] !== "Return to the work that matters."
  ) {
    throw new Error(
      `Options did not persist controls: ${JSON.stringify(optionsSettings)}`
    );
  }
  await optionsPage.close();

  await saveExtensionSettings(serviceWorker, DEFAULT_EXTENSION_SETTINGS);
  await page.goto(fixtureUrl);
  await page.waitForLoadState("domcontentloaded");
  await page
    .locator(
      "#top-ad.attention-redirector-slot .attention-redirector-card[data-mode='quiet']"
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

  // Give the live page a query string and a fragment without navigating, so the
  // next report is generated on a URL that carries something a reporter must not
  // publish. replaceState keeps the content script and its state alive.
  const secret = "SECRET-TOKEN-9421";
  await page.evaluate((token) => {
    history.replaceState(null, "", `${location.pathname}?session=${token}#private-fragment`);
  }, secret);

  const reportPopupPage = await context.newPage();
  await reportPopupPage.goto(`chrome-extension://${extensionId}/popup.html`);
  await reportPopupPage.locator("#reportMissedAd").click();
  await page
    .locator(".attention-redirector-inspector")
    .filter({ hasText: "Report missed ad" })
    .waitFor({ timeout: 5000 });
  await page.locator("#plain-missed-rectangle").scrollIntoViewIfNeeded();
  const reportTargetBox = await page.locator("#plain-missed-rectangle").boundingBox();
  if (!reportTargetBox) {
    throw new Error("No report target fixture bounding box.");
  }
  await page.mouse.click(
    reportTargetBox.x + reportTargetBox.width / 2,
    reportTargetBox.y + reportTargetBox.height / 2
  );
  await page
    .locator("[data-attention-redirector-inspector-copy-status]")
    .filter({ hasText: "Report copied" })
    .waitFor({ timeout: 5000 });
  const userReports = await loadSavedReports(serviceWorker);
  if (userReports.length < 2) {
    throw new Error(
      `Expected user report flow to save a second report, found ${userReports.length}.`
    );
  }

  const latestReport = userReports[0];
  if (latestReport.url !== `${fixtureUrl} (query and fragment removed)`) {
    throw new Error(
      `Report URL was not reduced to origin plus path. Got: ${latestReport.url}`
    );
  }
  for (const [field, value] of [
    ["url", latestReport.url],
    ["text", latestReport.text]
  ]) {
    if (value.includes(secret) || value.includes("private-fragment")) {
      throw new Error(
        `Report ${field} leaked the page query string or fragment, which a reporter pastes into a public issue.`
      );
    }
  }
  await reportPopupPage.close();

  console.log("extension id:", extensionId);
  console.log("fixture url:", fixtureUrl);
  console.log("fixture tab id:", fixtureTabId);
  console.log("quiet cards:", quietCardCount);
  console.log("compact cards:", compactCardCount);
  console.log("late replacement latency:", `${Math.round(lateReplacementLatency)}ms`);
  console.log(
    "late domain cosmetic latency:",
    `${Math.round(lateDomainCosmeticLatency)}ms`
  );
  console.log(
    "late shadow replacement latency:",
    `${Math.round(lateShadowReplacementLatency)}ms`
  );
  console.log("DNR probe:", "blocked / site-allowed / globally-disabled");
  console.log("LinkedIn app:", "DOM bypass / DNR active");
  console.log("YouTube prune:", "enabled prunes / site-disabled passes through");
  console.log("shadow card display:", shadowCardDisplay);
  console.log("framework reconciliation:", frameworkReconcileStatus);
  console.log("anchor texts:", anchorTexts);
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
  console.log("saved reports:", userReports.length);
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

async function assertLinkedinAppBypass(context, serviceWorker) {
  if (!serviceWorker) {
    throw new Error("No extension service worker available for LinkedIn checks.");
  }

  const fixtureUrl = "https://www.linkedin.com/mynetwork/attention-redirector-fixture";
  const probeUrl = "https://www.linkedin.com/attention-redirector-dnr-probe.js";

  await context.route(fixtureUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: [
        "<!doctype html>",
        "<meta charset=\"utf-8\">",
        "<title>LinkedIn My Network fixture</title>",
        "<div id=\"linkedin-static-ad\" class=\"ad-slot\" data-ad-slot=\"network-feed\" style=\"width:300px;height:250px\">Sponsored</div>",
        "<script>",
        "setTimeout(() => {",
        "  const slot = document.createElement('div');",
        "  slot.id = 'linkedin-late-ad';",
        "  slot.className = 'sponsored';",
        "  slot.style.cssText = 'width:300px;height:250px';",
        "  slot.textContent = 'Sponsored';",
        "  document.body.append(slot);",
        "}, 120);",
        "</script>"
      ].join("")
    });
  });
  await context.route(`${probeUrl}**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "window.__attentionRedirectorDnrProbeLoaded = true;"
    });
  });

  await saveExtensionSettings(serviceWorker, DEFAULT_EXTENSION_SETTINGS);
  await waitForEnabledRulesets(serviceWorker, true);
  const page = await context.newPage();
  await page.goto(fixtureUrl);
  await page.waitForTimeout(900);

  const replacementState = await page.evaluate(() => {
    return {
      slots: document.querySelectorAll(".attention-redirector-slot").length,
      staticText: document.getElementById("linkedin-static-ad")?.textContent || "",
      lateText: document.getElementById("linkedin-late-ad")?.textContent || ""
    };
  });
  if (
    replacementState.slots !== 0 ||
    replacementState.staticText !== "Sponsored" ||
    replacementState.lateText !== "Sponsored"
  ) {
    throw new Error(
      `LinkedIn app fixture received generic DOM replacements: ${JSON.stringify(replacementState)}`
    );
  }

  const dnrProbe = await loadDnrProbeScript(page);
  await page.close();
  if (dnrProbe.loaded) {
    throw new Error(
      `LinkedIn DOM bypass also disabled DNR: ${JSON.stringify(dnrProbe)}`
    );
  }
}

async function assertYoutubePruneBehavior(context, serviceWorker) {
  if (!serviceWorker) {
    throw new Error("No extension service worker available for YouTube checks.");
  }

  const fixtureUrl = "https://www.youtube.com/youtube-prune-fixture";
  const playerUrl = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
  const playerPayload = {
    videoDetails: { videoId: "fixture" },
    adPlacements: [{ ad: "top-level" }],
    playerAds: [{ ad: "legacy" }],
    nested: {
      adSlots: [{ ad: "slot" }],
      keep: "content"
    }
  };

  await context.route(fixtureUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: [
        "<!doctype html>",
        "<meta charset=\"utf-8\">",
        "<title>YouTube prune fixture</title>",
        "<div id=\"google_ads_iframe_fixture\" class=\"ad-slot\" style=\"width:300px;height:250px\">Advertisement</div>"
      ].join("")
    });
  });
  await context.route("https://www.youtube.com/youtubei/v1/player**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(playerPayload)
    });
  });

  await saveExtensionSettings(serviceWorker, DEFAULT_EXTENSION_SETTINGS);
  const enabledPage = await context.newPage();
  await enabledPage.goto(fixtureUrl);
  await enabledPage.waitForFunction(() => {
    return window.__attentionRedirectorYoutubePruneInstalled === true;
  });
  await enabledPage.waitForTimeout(900);
  const youtubeGenericSlots = await enabledPage
    .locator(".attention-redirector-slot")
    .count();
  if (youtubeGenericSlots !== 0) {
    throw new Error(
      `Generic DOM replacement ran on YouTube fixture: ${youtubeGenericSlots} slots.`
    );
  }
  const enabledResult = await readYoutubePruneFixture(enabledPage, playerUrl);

  if (
    hasYoutubeAdFields(enabledResult.fetchJson) ||
    hasYoutubeAdFields(enabledResult.xhrJson) ||
    hasYoutubeAdFields(enabledResult.globalResponse)
  ) {
    throw new Error(
      `YouTube prune left ad fields while enabled: ${JSON.stringify(enabledResult)}`
    );
  }

  if (enabledResult.fetchJson?.nested?.keep !== "content") {
    throw new Error(
      `YouTube prune removed non-ad player data: ${JSON.stringify(enabledResult.fetchJson)}`
    );
  }

  if (
    !enabledResult.adSkipResult?.skipClicked ||
    enabledResult.adSkipResult?.adSlotDisplay !== "none"
  ) {
    throw new Error(
      `YouTube ad suppression did not skip/hide the mocked ad surface: ${JSON.stringify(enabledResult.adSkipResult)}`
    );
  }

  const disabledSettings = {
    ...DEFAULT_EXTENSION_SETTINGS,
    disabledDomains: ["youtube.com"]
  };
  await saveExtensionSettings(serviceWorker, disabledSettings);
  await enabledPage.waitForTimeout(700);
  const openPageDisabledResult = await readYoutubeAdSuppressionFixture(enabledPage);
  await enabledPage.close();

  if (
    openPageDisabledResult.skipClicked ||
    openPageDisabledResult.adSlotDisplay === "none"
  ) {
    throw new Error(
      `YouTube ad suppression stayed active after open-page site disable: ${JSON.stringify(openPageDisabledResult)}`
    );
  }

  await saveExtensionSettings(serviceWorker, disabledSettings);
  const disabledPage = await context.newPage();
  await disabledPage.goto(`${fixtureUrl}?disabled=1`);
  await disabledPage.waitForTimeout(700);
  const disabledResult = await readYoutubePruneFixture(disabledPage, playerUrl);
  await disabledPage.close();

  if (disabledResult.installed) {
    throw new Error("YouTube prune main-world script was injected on a disabled site.");
  }

  if (
    !hasYoutubeAdFields(disabledResult.fetchJson) ||
    !hasYoutubeAdFields(disabledResult.xhrJson) ||
    !hasYoutubeAdFields(disabledResult.globalResponse)
  ) {
    throw new Error(
      `YouTube prune changed player data on a disabled site: ${JSON.stringify(disabledResult)}`
    );
  }

  if (
    disabledResult.adSkipResult?.skipClicked ||
    disabledResult.adSkipResult?.adSlotDisplay === "none"
  ) {
    throw new Error(
      `YouTube ad suppression ran on a disabled site: ${JSON.stringify(disabledResult.adSkipResult)}`
    );
  }

  await saveExtensionSettings(serviceWorker, DEFAULT_EXTENSION_SETTINGS);
}

async function readYoutubePruneFixture(page, playerUrl) {
  return page.evaluate(async (url) => {
    const fetchJson = await fetch(url).then((response) => response.json());
    const xhrJson = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", `${url}&xhr=1`);
      xhr.onload = () => {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (error) {
          reject(error);
        }
      };
      xhr.onerror = () => reject(new Error("XHR failed"));
      xhr.send();
    });

    window.ytInitialPlayerResponse = {
      videoDetails: { videoId: "global-fixture" },
      adPlacements: [{ ad: "global" }],
      playerAds: [{ ad: "global-legacy" }],
      nested: {
        adSlots: [{ ad: "global-slot" }],
        keep: "global-content"
      }
    };
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    const player = document.createElement("div");
    player.id = "movie_player";
    player.className = "ad-showing";
    const skipButton = document.createElement("button");
    skipButton.className = "ytp-ad-skip-button";
    skipButton.textContent = "Skip";
    window.__attentionRedirectorSkipClicked = false;
    skipButton.addEventListener("click", () => {
      window.__attentionRedirectorSkipClicked = true;
    });
    const adSlot = document.createElement("ytd-ad-slot-renderer");
    adSlot.textContent = "Sponsored";
    document.body.append(player, skipButton, adSlot);
    await new Promise((resolve) => window.setTimeout(resolve, 550));
    const adSkipResult = {
      skipClicked: window.__attentionRedirectorSkipClicked === true,
      adSlotDisplay: getComputedStyle(adSlot).display
    };
    player.remove();
    skipButton.remove();
    adSlot.remove();

    return {
      installed: window.__attentionRedirectorYoutubePruneInstalled === true,
      fetchJson,
      xhrJson,
      globalResponse: window.ytInitialPlayerResponse,
      adSkipResult
    };
  }, playerUrl);
}

async function readYoutubeAdSuppressionFixture(page) {
  return page.evaluate(async () => {
    const player = document.createElement("div");
    player.id = "movie_player";
    player.className = "ad-showing";
    const skipButton = document.createElement("button");
    skipButton.className = "ytp-ad-skip-button";
    skipButton.textContent = "Skip";
    window.__attentionRedirectorSkipClicked = false;
    skipButton.addEventListener("click", () => {
      window.__attentionRedirectorSkipClicked = true;
    });
    const adSlot = document.createElement("ytd-ad-slot-renderer");
    adSlot.textContent = "Sponsored";
    document.body.append(player, skipButton, adSlot);
    await new Promise((resolve) => window.setTimeout(resolve, 550));
    const result = {
      skipClicked: window.__attentionRedirectorSkipClicked === true,
      adSlotDisplay: getComputedStyle(adSlot).display
    };
    player.remove();
    skipButton.remove();
    adSlot.remove();
    return result;
  });
}

function hasYoutubeAdFields(value) {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some(hasYoutubeAdFields);
  }

  return Object.keys(value).some((key) => {
    return (
      key === "adPlacements" ||
      key === "adSlots" ||
      key === "playerAds" ||
      hasYoutubeAdFields(value[key])
    );
  });
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

// A slot can be replaced and still leave the page reading as if nothing
// happened: the site's caption sits outside the slot, so the word survives over
// a gap the wrapper still reserves. Counting cards cannot see that; only asking
// what a reader can still read can.
async function findCaptionSurvivors(page) {
  return page.evaluate(() => {
    const CAPTIONS =
      /^(advertisement|advertising|sponsored|sponsored content|promoted|paid post|реклама|на правах реклами)[.:]?$/i;

    const isReadable = (element) => {
      let current = element;
      while (current && current !== document.documentElement) {
        const style = getComputedStyle(current);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number.parseFloat(style.opacity || "1") === 0
        ) {
          return false;
        }
        current = current.parentElement;
      }
      return true;
    };

    return Array.from(document.querySelectorAll("body *"))
      .filter((element) => {
        if (element.closest("[class*='attention-redirector']")) return false;
        // An fp- bait is something that must survive untouched, so a caption
        // inside one is the passing result: the editorial legend reading
        // "Реклама", the "Sponsored" row in a real account menu.
        if (element.closest("[id^='fp-']")) return false;
        // A caption inside a link is the site's own chrome, not a slot badge —
        // the "Advertising" entry in a footer or account menu points at the
        // ad-sales page. The replacer skips these deliberately, so asserting on
        // them would gate a behaviour we chose not to have.
        if (element.closest("a")) return false;
        if (element.querySelector("*")) return false;
        if (!CAPTIONS.test((element.textContent || "").trim())) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && isReadable(element);
      })
      .map((element) => {
        const owner = element.closest("[id]");
        return `${element.localName}.${element.className || "-"} in #${
          owner ? owner.id : "?"
        }`;
      });
  });
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
        visuallyHidden ||=
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number.parseFloat(style.opacity || "1") === 0;
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
