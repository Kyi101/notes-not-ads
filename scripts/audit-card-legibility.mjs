// Card legibility audit: renders the real content script into every ad shape we
// ship against, crossed with every note length a user can type, and measures
// whether the note actually fits.
//
// The extension test suite proves cards appear. It has never proved the text
// inside them is readable, so a card that silently crops its note to two of
// three lines passes every gate. This script closes that hole: it asserts on the
// rendered box, not on the fact that a card exists.
//
//   node scripts/audit-card-legibility.mjs
//
// Writes per-cell screenshots and an HTML contact sheet to
// runs/card-legibility/<timestamp>/ and exits non-zero if any cell fails.

import { chromium } from "@playwright/test";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const fixturePath = path.join(projectRoot, "tests/fixtures/card-matrix.html");

// The longest note the UI accepts is the popup's 180 characters; options caps at
// 160. Auditing the larger of the two is what matters, since that is what can
// reach a card.
const NOTE_CASES = [
  ["one-word", "Focus"],
  ["short", "Ship the draft."],
  ["default", "Finish what deserves your attention."],
  [
    "medium",
    "Write the section you have been avoiding, then close the tab and take the walk."
  ],
  [
    "max-180",
    "You said this week you would stop opening the news tab before lunch and would instead finish the outline, so close this, open the document, and write the next paragraph now."
  ],
  // A pasted link is an unbreakable token: it cannot wrap at a space, so it is
  // the case that exposes whether the card can break a long word at all.
  ["long-word", "Open localhost:5173/dashboard/reports/quarterly-summary-draft"]
];

const VIEWPORT = { width: 1800, height: 1000 };

const runDir = path.join(
  projectRoot,
  "runs/card-legibility",
  new Date().toISOString().replace(/[:.]/g, "-")
);

const server = await startFixtureServer();
const userDataDir = await mkdtemp(path.join(os.tmpdir(), "ar-card-audit-"));
let context;
let failed = 0;

try {
  await mkdir(runDir, { recursive: true });

  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: VIEWPORT,
    args: [
      `--disable-extensions-except=${projectRoot}`,
      `--load-extension=${projectRoot}`
    ]
  });

  const serviceWorker = await findServiceWorker(context);
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);
  const fixtureUrl = `http://127.0.0.1:${server.port}/card-matrix.html`;

  const cells = [];

  for (const [noteId, note] of NOTE_CASES) {
    await saveSettings(serviceWorker, {
      enabled: true,
      mode: "anchor",
      anchorNote: note,
      anchorNotes: [note],
      visualPresence: 10,
      reducedMotion: "still",
      disabledDomains: []
    });

    await page.goto(fixtureUrl, { waitUntil: "domcontentloaded" });
    await page
      .locator("#matrix-ad-leaderboard .attention-redirector-card")
      .waitFor({ timeout: 10000 });
    // Cards fade in over 140ms and the tide layers animate; reducedMotion:still
    // stops the latter, and this settles the former before we measure.
    await page.waitForTimeout(400);

    const measurements = await page.evaluate(measureCards);

    for (const measurement of measurements) {
      const shot = `${measurement.label}--${noteId}.png`;
      // A card the host page made invisible cannot be photographed; the
      // measurement already recorded why.
      const captured = await page
        .locator(`#matrix-ad-${measurement.label} .attention-redirector-card`)
        .screenshot({ path: path.join(runDir, shot), timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      cells.push({ ...measurement, noteId, note, shot: captured ? shot : null });
    }

    const rendered = new Set(measurements.map((entry) => entry.label));
    for (const slot of await page.evaluate(() =>
      [...document.querySelectorAll("[data-matrix-label]")].map((element) => ({
        label: element.dataset.matrixLabel,
        expect: element.dataset.matrixExpect || null,
        width: Number(element.dataset.matrixWidth),
        height: Number(element.dataset.matrixHeight)
      }))
    )) {
      if (!rendered.has(slot.label)) {
        // A slot the site keeps hidden is meant to stay empty, so an absent card
        // is the passing result rather than a miss.
        const empty = slot.expect === "no-card";
        cells.push({
          label: slot.label,
          noteId,
          note,
          shot: null,
          problems: empty ? [] : ["no-card-rendered"],
          expected: empty ? ["left-empty-by-design"] : [],
          slotWidth: slot.width,
          slotHeight: slot.height
        });
      }
    }
  }

  failed = cells.filter((cell) => cell.problems.length).length;

  await writeFile(path.join(runDir, "report.html"), renderReport(cells), "utf8");
  await writeFile(
    path.join(runDir, "report.json"),
    JSON.stringify(cells, null, 2),
    "utf8"
  );

  printSummary(cells);
  console.log(`\nContact sheet: ${path.join(runDir, "report.html")}`);
} finally {
  if (context) {
    await context.close();
  }
  server.close();
  await rm(userDataDir, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);

// Runs in the page. Everything it reports is a measurement of the rendered box —
// no judgement about whether a given shape "should" look a certain way.
function measureCards() {
  const TOLERANCE = 1;
  const CENTER_TOLERANCE = 2;

  return [...document.querySelectorAll("[data-matrix-label]")]
    .map((slot) => {
      const card = slot.querySelector(".attention-redirector-card");
      if (!card) {
        return null;
      }

      if (slot.dataset.matrixExpect === "no-card") {
        return {
          label: slot.dataset.matrixLabel,
          slotWidth: Number(slot.dataset.matrixWidth),
          slotHeight: Number(slot.dataset.matrixHeight),
          problems: ["card-rendered-in-hidden-slot"],
          expected: []
        };
      }

      const body = card.querySelector(".attention-redirector-card__body");
      const cardRect = card.getBoundingClientRect();
      const cardStyle = getComputedStyle(card);
      const problems = [];

      if (!body) {
        return {
          label: slot.dataset.matrixLabel,
          slotWidth: Number(slot.dataset.matrixWidth),
          slotHeight: Number(slot.dataset.matrixHeight),
          problems: ["anchor-note-missing"],
          expected: []
        };
      }

      const bodyRect = body.getBoundingClientRect();
      const bodyStyle = getComputedStyle(body);

      // A note nobody can see is a worse failure than a cropped one, and none of
      // the box measurements below would notice it.
      const fill = bodyStyle.webkitTextFillColor || bodyStyle.color;
      if (
        bodyStyle.visibility !== "visible" ||
        Number(bodyStyle.opacity) === 0 ||
        /rgba\([^)]*,\s*0\s*\)/.test(fill) ||
        fill === "transparent"
      ) {
        problems.push("note-invisible");
      }

      // The card's content box: what the note is actually allowed to occupy.
      const content = {
        top: cardRect.top + parseFloat(cardStyle.paddingTop),
        right: cardRect.right - parseFloat(cardStyle.paddingRight),
        bottom: cardRect.bottom - parseFloat(cardStyle.paddingBottom),
        left: cardRect.left + parseFloat(cardStyle.paddingLeft)
      };

      // -webkit-line-clamp drops whole lines and overflow:hidden shaves partial
      // ones. Both show up here as scroll size exceeding client size.
      if (body.scrollHeight > body.clientHeight + TOLERANCE) {
        problems.push("note-cropped-vertically");
      }
      if (body.scrollWidth > body.clientWidth + TOLERANCE) {
        problems.push("note-cropped-horizontally");
      }

      // Even a note that fits its own box is cropped if that box hangs outside
      // the card, because the card clips with overflow:hidden + contain:paint.
      if (
        bodyRect.top < content.top - TOLERANCE ||
        bodyRect.bottom > content.bottom + TOLERANCE ||
        bodyRect.left < content.left - TOLERANCE ||
        bodyRect.right > content.right + TOLERANCE
      ) {
        problems.push("note-overflows-card");
      }

      const offsetX =
        (bodyRect.left + bodyRect.right) / 2 - (content.left + content.right) / 2;
      const offsetY =
        (bodyRect.top + bodyRect.bottom) / 2 - (content.top + content.bottom) / 2;

      // A left-aligned note in a narrow slot is deliberate, so only the block
      // position is checked there; everywhere else the card claims to centre.
      const centersHorizontally = cardStyle.textAlign === "center";
      if (centersHorizontally && Math.abs(offsetX) > CENTER_TOLERANCE) {
        problems.push("note-off-centre-horizontally");
      }
      if (Math.abs(offsetY) > CENTER_TOLERANCE) {
        problems.push("note-off-centre-vertically");
      }

      // A note longer than the slot can hold at a readable size is meant to end
      // in an ellipsis. That is the designed floor, not a defect — but cropping
      // above the floor means the card could have shrunk and did not.
      const CARD_FONT_FLOOR = 13;
      const atFloor = parseFloat(bodyStyle.fontSize) <= CARD_FONT_FLOOR;
      const expected = atFloor
        ? problems.filter((problem) => problem.startsWith("note-cropped"))
        : [];

      return {
        expected,
        label: slot.dataset.matrixLabel,
        slotWidth: Number(slot.dataset.matrixWidth),
        slotHeight: Number(slot.dataset.matrixHeight),
        cardWidth: Math.round(cardRect.width),
        cardHeight: Math.round(cardRect.height),
        fontSize: bodyStyle.fontSize,
        lineClamp: bodyStyle.webkitLineClamp,
        padding: cardStyle.padding,
        slotClasses: slot.className,
        inherited: {
          whiteSpace: bodyStyle.whiteSpace,
          writingMode: bodyStyle.writingMode,
          textTransform: bodyStyle.textTransform,
          textIndent: bodyStyle.textIndent,
          letterSpacing: bodyStyle.letterSpacing,
          textDecorationLine: bodyStyle.textDecorationLine,
          overflowWrap: bodyStyle.overflowWrap,
          visibility: bodyStyle.visibility
        },
        bodyScrollHeight: body.scrollHeight,
        bodyClientHeight: body.clientHeight,
        bodyScrollWidth: body.scrollWidth,
        bodyClientWidth: body.clientWidth,
        offsetX: Math.round(offsetX),
        offsetY: Math.round(offsetY),
        problems: problems.filter((problem) => !expected.includes(problem))
      };
    })
    .filter(Boolean);
}

function printSummary(cells) {
  const byProblem = new Map();
  for (const cell of cells) {
    for (const problem of cell.problems) {
      byProblem.set(problem, (byProblem.get(problem) || 0) + 1);
    }
  }

  const failing = cells.filter((cell) => cell.problems.length);
  const bydesign = cells.filter(
    (cell) => !cell.problems.length && cell.expected.length
  );
  console.log(
    `\n${cells.length - failing.length} of ${cells.length} cells legible` +
      `${bydesign.length ? ` (${bydesign.length} by design)` : ""}.\n`
  );

  for (const cell of bydesign) {
    console.log(
      `  BY DESIGN ${cell.label} (${cell.slotWidth}x${cell.slotHeight}) / ` +
        `${cell.noteId}${cell.fontSize ? ` @ ${cell.fontSize}` : ""}: ` +
        cell.expected.join(", ")
    );
  }

  if (!failing.length) {
    return;
  }

  console.log("");

  for (const [problem, count] of [...byProblem].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(3)}  ${problem}`);
  }

  console.log("");
  for (const cell of failing) {
    const size =
      cell.slotWidth === null ? "?" : `${cell.slotWidth}x${cell.slotHeight}`;
    console.log(
      `  FAIL ${cell.label} (${size}) / ${cell.noteId}` +
        `${cell.fontSize ? ` @ ${cell.fontSize}` : ""}: ${cell.problems.join(", ")}`
    );
  }
}

function renderReport(cells) {
  const noteIds = NOTE_CASES.map(([id]) => id);
  const labels = [...new Set(cells.map((cell) => cell.label))];

  const rows = labels
    .map((label) => {
      const cellsFor = noteIds.map((noteId) =>
        cells.find((cell) => cell.label === label && cell.noteId === noteId)
      );
      const size = cellsFor.find((cell) => cell?.slotWidth)
        ? `${cellsFor.find((cell) => cell.slotWidth).slotWidth}x${
            cellsFor.find((cell) => cell.slotWidth).slotHeight
          }`
        : "";

      return `<tr><th>${escapeHtml(label)}<small>${escapeHtml(size)}</small></th>${cellsFor
        .map((cell) => renderCell(cell))
        .join("")}</tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Card legibility audit</title>
<style>
  body { margin: 0; padding: 24px; background: #14181a; color: #e8ece9;
         font: 13px/1.5 ui-monospace, "SFMono-Regular", Consolas, monospace; }
  h1 { font-size: 16px; font-weight: 700; margin: 0 0 4px; }
  p.lede { margin: 0 0 24px; color: #8c9a94; max-width: 70ch; }
  table { border-collapse: collapse; }
  th { text-align: left; vertical-align: top; padding: 8px 14px 8px 0;
       font-weight: 700; white-space: nowrap; }
  th small { display: block; font-weight: 400; color: #8c9a94; }
  td { vertical-align: top; padding: 8px 14px 8px 0; }
  td img { display: block; max-width: 340px; height: auto; border-radius: 6px; }
  thead th { color: #8c9a94; }
  .ok { color: #7fc7a4; }
  .clamped { color: #d6c07a; }
  .bad { color: #ef8f74; }
  .bad ul { margin: 4px 0 0; padding-left: 16px; }
  .meta { color: #8c9a94; margin-top: 4px; }
</style></head><body>
<h1>Card legibility audit</h1>
<p class="lede">One cell per ad shape and note length. A cell fails when the note
is cropped, spills outside the card, or sits off centre — the three ways a card
can render without being readable. A cell already at the smallest readable font
is marked clamped instead: the note is longer than the slot can hold, so ending
it in an ellipsis is the designed outcome rather than a defect.</p>
<table>
<thead><tr><th></th>${noteIds
    .map((id) => `<th>${escapeHtml(id)}</th>`)
    .join("")}</tr></thead>
<tbody>
${rows}
</tbody></table></body></html>
`;
}

function renderCell(cell) {
  if (!cell) {
    return "<td></td>";
  }

  const image = cell.shot
    ? `<img src="${escapeHtml(cell.shot)}" alt="">`
    : "<em>no card</em>";
  const status = cell.problems.length
    ? `<div class="bad"><ul>${cell.problems
        .map((problem) => `<li>${escapeHtml(problem)}</li>`)
        .join("")}</ul></div>`
    : cell.expected?.length
      ? `<div class="clamped">${escapeHtml(cell.expected.join(", "))}</div>`
      : `<div class="ok">legible</div>`;
  const meta = cell.fontSize
    ? `<div class="meta">${escapeHtml(cell.fontSize)} · clamp ${escapeHtml(
        String(cell.lineClamp)
      )} · pad ${escapeHtml(cell.padding)}</div>`
    : "";

  return `<td>${image}${status}${meta}</td>`;
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[character]
  );
}

async function saveSettings(serviceWorker, settings) {
  return serviceWorker.evaluate(async (value) => {
    await chrome.storage.local.set({ attentionRedirectorSettings: value });
  }, settings);
}

async function findServiceWorker(context) {
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker", {
      timeout: 15000
    });
  }
  return serviceWorker;
}

function startFixtureServer() {
  return new Promise((resolve, reject) => {
    const httpServer = http.createServer(async (request, response) => {
      const url = new URL(request.url || "/", "http://127.0.0.1");

      if (!url.pathname.endsWith("/card-matrix.html")) {
        response.writeHead(404, { "Content-Type": "text/plain" });
        response.end("Not found");
        return;
      }

      try {
        const html = await readFile(fixturePath, "utf8");
        response.writeHead(200, {
          "Content-Type": "text/html",
          "Cache-Control": "no-store"
        });
        response.end(html);
      } catch (error) {
        response.writeHead(500, { "Content-Type": "text/plain" });
        response.end(String(error));
      }
    });

    httpServer.on("error", reject);
    httpServer.listen(0, "127.0.0.1", () => {
      resolve({
        port: httpServer.address().port,
        close: () => httpServer.close()
      });
    });
  });
}
