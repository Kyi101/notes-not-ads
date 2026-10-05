// Browser tests of the actual content modules with controlled DOM and scan
// timing. No external websites, accounts, or extension startup races involved.
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { measureReadableText } from "./live-eval-health.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Allows the same fixtures to prove failures against a previous revision.
const sourceRoot = process.env.SCANNER_SOURCE_ROOT || root;
const modules = await Promise.all(
  ["shared", "main", "inspector", "scanner", "replacer"].map((name) =>
    readFile(path.join(sourceRoot, `src/${name}.js`), "utf8")
  )
);
const source = `(function(){\n${modules.join("\n")}\n
  state.settingsReady = true;
  window.scannerTest = { state, runScan, applySettingsToReplacedSlots, inspectElement };
})();`;
const browser = await chromium.launch({ headless: true });
const failures = [];

async function makePage(html) {
  const page = await browser.newPage();
  // All fixture resources are inert, including ad hosts in the positive cases.
  await page.route("**/*", (route) => route.fulfill({ status: 200, body: "" }));
  await page.goto("https://ordinary.example/");
  await page.setContent(html);
  await page.addStyleTag({ path: path.join(root, "src/content.css") });
  await page.addScriptTag({ content: source });
  return page;
}

async function check(name, work) {
  try { await work(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`); }
}

try {
  await check("hidden loading text cannot pass page health", async () => {
    const page = await browser.newPage();
    await page.setContent('<script type="application/json">{"loading":"yes"}</script><p hidden>Hidden</p><div style="opacity:0"><p>Invisible loading text</p></div><p style="visibility:hidden">Hidden</p>');
    assert.equal(await page.evaluate(measureReadableText), 0);
    await page.evaluate(() => { const p = document.createElement("p"); p.textContent = "Usable content"; document.body.append(p); });
    assert.ok(await page.evaluate(measureReadableText) > 0);
    await page.close();
  });
  const page = await makePage(await readFile(path.join(root, "tests/fixtures/false-positive-surfaces.html"), "utf8"));
  await page.evaluate(() => scannerTest.runScan({ force: true }));
  for (const id of ["encoded-icons", "blob-preview", "query-photo", "path-photo", "hostname-photo", "userinfo-photo", "embedded-preview", "native-control", "aria-control", "control-wrapper", "editable-control", "plaintext-control", "toolbar-wrapper", "deep-widget"]) {
    await check(`${id} survives`, async () => {
      assert.equal(await page.locator(`#${id}`).evaluate((node) => Boolean(
        node.closest(".attention-redirector-slot") || node.querySelector(".attention-redirector-slot")
      )), false);
    });
  }
  for (const id of ["real-network-slot", "real-hyphenated-network", "real-embedded-slot", "real-ad-controls", "real-empty-slot"]) {
    await check(`${id} still replaced`, async () => {
      assert.equal(await page.locator(`#${id} .attention-redirector-card`).count(), 1);
    });
  }
  await page.close();

  await check("late notes avoid both existing neighbours without changing them", async () => {
    const page = await makePage('<div id="first" class="ad-slot" style="width:300px;height:250px"></div><div id="later"></div><div id="last" class="ad-slot" style="width:300px;height:250px"></div>');
    await page.evaluate(async () => {
      scannerTest.state.settings.anchorNotes = ["One", "Two", "Three"];
      scannerTest.state.noteCursor = 0;
      await scannerTest.runScan({ force: true });
    });
    const before = await page.locator(".attention-redirector-card__body").allTextContents();
    assert.deepEqual(before, ["One", "Two"]);
    await page.evaluate(async () => {
      // A later scan's cursor can land on either neighbour (as it does when
      // other ad slots rendered between the two scans on the real fixture).
      scannerTest.state.noteCursor = 4;
      const later = document.getElementById("later");
      later.className = "ad-slot";
      later.style.cssText = "width:300px;height:250px";
      await scannerTest.runScan({ force: false, contextNodes: [later] });
    });
    assert.deepEqual(await page.locator(".attention-redirector-card__body").allTextContents(), ["One", "Three", "Two"]);
    await page.evaluate(() => scannerTest.applySettingsToReplacedSlots());
    assert.deepEqual(await page.locator(".attention-redirector-card__body").allTextContents(), ["One", "Three", "Two"]);
    await page.close();
  });
} finally {
  await browser.close();
}
assert.equal(failures.length, 0, `${failures.length} scanner regressions: ${failures.join(", ")}`);
