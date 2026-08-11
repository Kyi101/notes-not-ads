import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const iconsDir = path.join(projectRoot, "icons");
const ICON_SIZES = [16, 32, 48, 128];

// A pinned note: one mass with a cut corner and a punched hole.
//
// Chrome does not tint extension icons, so this one PNG lands on a #dee1e6
// toolbar and a #292a2d one. The product's own values cannot cover both: ink
// #20312a measures 1.05:1 on the dark toolbar and surface #e6ebe3 measures
// 1.08:1 on the light one, so each is invisible on one of the two. #c2542b
// needs no partner — 3.48:1 light, 3.14:1 dark — so there is no tile here.
//
// That single-value constraint is also why the pin is a hole rather than a
// second disc: a gap between two masses would have to be drawn in a colour,
// and no second colour survives both toolbars. Punched through, the gap is
// whatever the toolbar already is.
//
// The icon is exempt from the card's flat rule. The card is flat so it does not
// fight the host page it lands in; the toolbar icon has no host page.
//
// Sized against the 16px cell, where roughly 14 pixels are usable. The
// silhouette spans x 10-118 and y 12-116 so it fills that cell rather than
// floating in it, and the hole is R 16 — about 2px at 16px. At R 13 the hole
// rasterises to one soft pixel and reads as a smudge; R 16 stays a hole. Two
// separate bodies were tried first and a disc above a rounded rectangle reads
// as an avatar at any size, which is why the pin is subtractive.
const ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs>
    <mask id="pinhole">
      <rect width="128" height="128" fill="#fff"/>
      <circle cx="43" cy="41" r="16" fill="#000"/>
    </mask>
  </defs>
  <path d="M23 12 h65 l30 30 v61 a13 13 0 0 1 -13 13 h-82 a13 13 0 0 1 -13 -13 v-78 a13 13 0 0 1 13 -13 z" fill="#c2542b" mask="url(#pinhole)"/>
</svg>
`.trim();

const browser = await chromium.launch();
await mkdir(iconsDir, { recursive: true });

for (const size of ICON_SIZES) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1
  });
  const svgUrl = `data:image/svg+xml;base64,${Buffer.from(ICON_SVG).toString("base64")}`;
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:transparent}</style>` +
      `<img src="${svgUrl}" width="${size}" height="${size}" style="display:block">`
  );
  await page.locator("img").waitFor();
  const png = await page.screenshot({ omitBackground: true });
  await writeFile(path.join(iconsDir, `icon-${size}.png`), png);
  await page.close();
  console.log(`Wrote icons/icon-${size}.png`);
}

await browser.close();
