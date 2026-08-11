import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const iconsDir = path.join(projectRoot, "icons");
const ICON_SIZES = [16, 32, 48, 128];

// An empty billboard: the ad surface the extension takes over.
//
// Chrome does not tint extension icons, so this one PNG lands on a #dee1e6
// toolbar and a #292a2d one. The product's own values cannot cover both: ink
// #20312a measures 1.05:1 on the dark toolbar and surface #e6ebe3 measures
// 1.08:1 on the light one, so each is invisible on one of the two. #c2542b
// needs no partner — 3.48:1 light, 3.14:1 dark — so there is no tile here.
//
// The legs are the whole point. At 16px a mark has to be read as a silhouette,
// and every centred symmetric blob — rounded square, disc, document, tag — is
// already generic. Earlier rounds drew notes, and a note is exactly that blob:
// legible but indistinguishable from a file icon. Something has to stick out.
// The legs are also what carries the meaning, since a panel on posts is the one
// object that says "ad space" without any interior detail.
//
// The icon is exempt from the card's flat rule. The card is flat so it does not
// fight the host page it lands in; the toolbar icon has no host page.
//
// Sized against the 16px cell, where roughly 14 pixels are usable. Legs run 19
// units wide with a 30-unit gap — about 2.4px and 3.75px at 16px, so both the
// legs and the gap between them survive rasterisation. Thinner legs or a wider
// stance both fail: at 16 units the legs wash out on the dark toolbar, and
// moving them to the panel corners reads as a table. Splaying them reads as an
// easel. Interior detail of any kind, including note lines on the panel, is
// impossible here — it smears into a single grey mass.
const ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect x="6" y="12" width="116" height="56" rx="9" fill="#c2542b"/>
  <rect x="30" y="68" width="19" height="48" fill="#c2542b"/>
  <rect x="79" y="68" width="19" height="48" fill="#c2542b"/>
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
