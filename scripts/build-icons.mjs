import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const iconsDir = path.join(projectRoot, "icons");
const ICON_SIZES = [16, 32, 48, 128];

// One crescent, bare on transparency.
//
// Chrome does not tint extension icons, so this one PNG lands on a #dee1e6
// toolbar and a #292a2d one. The product's own values cannot cover both: ink
// #20312a measures 1.05:1 on the dark toolbar and surface #e6ebe3 measures
// 1.08:1 on the light one, so each is invisible on one of the two. Earlier
// marks paired them inside a rounded-square tile for that reason. #c2542b
// needs no partner — 3.48:1 light, 3.14:1 dark — so there is no tile here.
//
// The icon is exempt from the card's flat rule. The card is flat so it does not
// fight the host page it lands in; the toolbar icon has no host page.
//
// Geometry is solved rather than eyeballed: outer disc R 62, horn opening 115
// degrees, mass 52 units thick, then translated so the crescent's own bounding
// box is centred. Centring the disc instead pushes the mark five units past the
// right edge and shaves the lower horn. 52 units is 6.5px of ink at 16px; below
// about 5px the horn tips go wispy and anti-aliasing washes the mark out on the
// dark toolbar, where it has the least contrast to spend.
const ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs>
    <mask id="bite">
      <circle cx="64" cy="60.24" r="62" fill="#fff"/>
      <circle cx="84.95" cy="22.44" r="53.22" fill="#000"/>
    </mask>
  </defs>
  <circle cx="64" cy="60.24" r="62" fill="#c2542b" mask="url(#bite)"/>
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
