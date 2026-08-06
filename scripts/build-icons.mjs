import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const iconsDir = path.join(projectRoot, "icons");
const ICON_SIZES = [16, 32, 48, 128];

// A card placed in a slot. The card is the product's light tone from
// src/content.css — surface #e6ebe3, ink #20312a — at the 6/5 aspect the
// welcome preview uses, with the note set left as the real one sets it.
//
// The surround is the ink, not more surface, because Chrome does not tint
// extension icons: this one PNG lands on a #dee1e6 toolbar and a #292a2d one.
// A mark in a single value disappears into one of them. Carrying both means
// neither can swallow it — the ink holds the silhouette on the light toolbar,
// the card holds it on the dark.
//
// Two note bars, at every size. A single bar survives 16px more cleanly but
// reads as a minus sign, which says "removed" where the product says "replaced".
const ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect x="4" y="4" width="120" height="120" rx="24" fill="#20312a"/>
  <rect x="24" y="31" width="80" height="67" rx="10" fill="#e6ebe3"/>
  <rect x="37" y="52" width="54" height="9" rx="4.5" fill="#20312a"/>
  <rect x="37" y="70" width="32" height="9" rx="4.5" fill="#20312a"/>
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
