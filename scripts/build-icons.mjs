import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const iconsDir = path.join(projectRoot, "icons");
const ICON_SIZES = [16, 32, 48, 128];

// Mirrors the Tide card: --ar-field-a/b gradient, light sweep, ember orb.
const ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="field" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#d9e4d8"/>
      <stop offset="1" stop-color="#a5bca6"/>
    </linearGradient>
    <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0.4">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.42"/>
      <stop offset="0.55" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="ember" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#d9683a" stop-opacity="0.9"/>
      <stop offset="0.55" stop-color="#d9683a" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#d9683a" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="tile">
      <rect x="0" y="0" width="128" height="128" rx="26"/>
    </clipPath>
  </defs>
  <g clip-path="url(#tile)">
    <rect width="128" height="128" fill="url(#field)"/>
    <path d="M-20 96 C 24 74, 58 108, 148 78 L 148 148 L -20 148 Z"
      fill="#496555" opacity="0.32"/>
    <path d="M-20 108 C 30 90, 70 118, 148 94 L 148 148 L -20 148 Z"
      fill="#2f4a3c" opacity="0.34"/>
    <rect width="128" height="128" fill="url(#sweep)"/>
    <circle cx="92" cy="44" r="34" fill="url(#ember)"/>
  </g>
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
