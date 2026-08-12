import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const iconsDir = path.join(projectRoot, "icons");
const ICON_SIZES = [16, 32, 48, 128];

// A beamed pair of eighth notes whose noteheads are cards. The name carries the
// pun and the mark spends it: notes, plural, which is why two heads beat the
// single note that was the runner-up.
//
// Chrome does not tint extension icons, so this one PNG lands on a #dee1e6
// toolbar and a #292a2d one. The product's own values cannot cover both: ink
// #20312a measures 1.05:1 on the dark toolbar and surface #e6ebe3 measures
// 1.08:1 on the light one, so each is invisible on one of the two. #c2542b
// needs no partner — 3.48:1 light, 3.14:1 dark — so there is no tile here.
//
// At 16px a mark is read as a silhouette, and every centred symmetric blob —
// rounded square, disc, document, tag — is already generic. Six rounds of
// billboards, notes, crescents and viewfinders all lost on that, not on
// draughtsmanship. What wins here is the beam: a solid bar across the top with
// two stems dropping to staggered heads is an outline no UI kit contains. That
// it also reads as "music" is known and accepted; the name does the explaining.
//
// The icon is exempt from the card's flat rule. The card is flat so it does not
// fight the host page it lands in; the toolbar icon has no host page.
//
// Verified on the shipped raster at 16 and 32 on both toolbars: the counter
// under the beam stays open, and the two heads read separately rather than
// merging. Heads at 48x36 are deliberately heavy — thinner ones wash out on the
// dark toolbar, and stems at 16 units are the floor. The staggered head heights
// are a distinctiveness choice, not a legibility one: levelling them was
// rendered and keeps the counter open just as well, but makes the outline
// symmetric, which is the property every discarded round lost on.
const ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect x="36" y="10" width="84" height="22" fill="#c2542b"/>
  <rect x="36" y="10" width="16" height="82" fill="#c2542b"/>
  <rect x="104" y="10" width="16" height="64" fill="#c2542b"/>
  <rect x="4" y="80" width="48" height="36" rx="9" fill="#c2542b"/>
  <rect x="72" y="62" width="48" height="36" rx="9" fill="#c2542b"/>
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
