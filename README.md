# Attention Redirector

Attention Redirector is a Manifest V3 Chrome Extension release candidate that blocks common ad-network requests and replaces obvious ad/clutter surfaces with a quiet card carrying a note the user wrote. With no notes it removes them instead.

This product overlaps with ad blockers, but its unique value is still the attention surface: blocked or removed ad space becomes quiet, user-owned space instead of another feed. The network layer is intentionally bounded: static MV3 `declarativeNetRequest` rules for common ad requests, with DOM/cosmetic replacement and safety checks handling the visible surface.

## What It Does

- Runs as a content script on normal `http` and `https` webpages.
- Includes an MV3 service worker that toggles DNR rules globally and installs per-site/sensitive-page allow rules.
- Blocks common ad-network requests with packaged `declarativeNetRequest` static rules.
- Looks for likely ad/clutter containers using conservative DOM heuristics.
- Parses a conservative subset of EasyList/uBlock-style cosmetic `##` selectors.
- Applies local cosmetic rules plus a generated cosmetic snapshot, with every match still passing Attention Redirector safety checks.
- Promotes obvious ad children to their larger ad wrapper before replacing, to avoid partial ad-card sidecars.
- Handles common DOM ad patterns such as safeframe/footer ads and Google IMA-style video ad overlays.
- Starts at `document_end` and reacts to newly inserted slots on a short
  leading-edge schedule to reduce visible ad flash.
- Replaces matched slots with the Tide Ambient Field or collapses them out of layout.
- Preserves site-owned children inside container slots and renders Tide above
  them, so React/Next-style reconciliation can continue safely.
- Preserves the original slot height on Tide cards where possible to reduce layout jumps.
- Lets each inserted card be hidden.
- Carries up to five user-written notes, rotated deterministically across detected surfaces.
- Supports global enable/disable, current-site control, disabled domains, and reduced motion.
- Current-site disable and sensitive-page skips install high-priority DNR `allow` rules for requests initiated by those domains.
- Draws a card only while the user holds at least one note. Empty the notes and every detected surface is removed and the page reflows, with blocking still on.
- Opens a welcome page on first install and links to Options.

## What It Avoids

The content script skips sensitive or risky contexts:

- Google Docs, Gmail, Google Drive, Google account pages, Figma, Canva, and Notion
- Known banking/payment-style domains
- Checkout, cart, billing, payment, login, and password pages
- Pages with visible password fields
- Navigation, headers, footers, forms, comments, article bodies, and text editors
- Portaled dropdowns, menus, and listboxes, which can sit outside their header and inherit ad evidence from a child

A second, narrower tier keeps network blocking but turns off generic DOM
replacement entirely, because these sites run virtualized app UIs that break
when their containers are replaced: `linkedin.com`, YouTube, and
`translate.google.com`. YouTube keeps a dedicated, purpose-built pruning layer
instead.

The selector strategy is deliberately conservative. Missing some ads is preferable to breaking a page.

## Privacy

- No remote requests from the extension runtime during normal browsing.
- The developer-only list updater fetches EasyList only when explicitly run.
- No analytics.
- No accounts.
- No tracking.
- No user data leaves the browser.
- Settings are stored only with `chrome.storage.local`.

## Permissions

- `storage`: saves the notes, motion preference, and disabled domains locally.
- `activeTab`: lets the popup talk to the current page after the user opens it.
- `scripting`: lets the popup inject the existing content script into the active tab if the page was already open before the extension loaded or updated.
- `declarativeNetRequest`: blocks packaged ad-network request rules and installs per-site allow overrides.
- Static content script access to `http://*/*` and `https://*/*`: needed to inspect and replace page DOM slots.

## Load Unpacked In Chrome

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this project folder: `attention-redirector`.
6. Open a normal webpage and use the extension popup.

If a page was already open before loading the extension, refresh it so the content script can run.

After changing extension files locally, click the extension's reload button in `chrome://extensions`. The popup can now inject the content script into already-open normal webpages, but Chrome still needs the updated manifest loaded first.

## Local Browser Test

This project includes a Playwright smoke test for the extension:

```bash
npm run check
npm run test:extension
npm run test:onboarding
```

`npm run check` also runs a small parser test for cosmetic rules.

`test:onboarding` uses a fresh browser profile so `onInstalled` fires, then verifies that the welcome page auto-opens, that its CTA opens Options, and that a saved theme preference is applied.

`test:extension` launches Chromium with the unpacked extension, serves `tests/fixtures/ad-clutter.html` from a local server, and verifies DNR blocking, site/global DNR allow behavior, replacement patterns, latency, framework-owned DOM reconciliation, note rotation across surfaces, the empty-note collapse, reduced motion, popup/options persistence, settings migration, user-facing missed-ad reporting, and inspector behavior.

The test starts a local `127.0.0.1` server and opens Chromium, so it may need permission in sandboxed agent sessions.

## Release Package

Build the Chrome Web Store ZIP from the runtime allowlist:

```bash
npm run check
git status --short
npm run package:release
```

The release ZIP is written to `dist/`, which is ignored. The script uses a
runtime-file allowlist, so local artifacts and development files such as
`node_modules/`, `runs/`, `screenshots/`, `_metadata/`, tests, prototypes, and
developer scripts are excluded.

Only package a public release when `git status --short` is clean. Release
drafts live in `docs/`:

- `docs/privacy-policy.md`
- `docs/chrome-web-store.md`

## Performance Benchmark

Use the deterministic long-page benchmark to compare disabled, still Tide, and
animated Tide under the same continuous scroll workload:

```bash
npm run benchmark:performance
npm run benchmark:performance -- --slots 80 --duration-ms 12000 --runs 2
```

The benchmark reports frame p95/p99, long frames, main-thread task utilization,
layout/style duration, and heap use. Reports are written under
`runs/performance/`. Results are intended for before/after comparisons on the
same machine rather than a universal hardware-independent threshold.

## Live AdBlock Tester Benchmark

`https://adblock-tester.com/` is useful for seeing the gap between visual DOM replacement and a full ad blocker. Run:

```bash
npm run test:adblock-tester
```

The benchmark fails if the score drops below `80/100`. Override only for
diagnosis with:

```bash
ADBLOCK_TESTER_MIN_SCORE=0 npm run test:adblock-tester
```

The script opens Chromium with the unpacked extension, waits for the tester page, then prints:

- the tester score line
- the required minimum score
- service-by-service check details
- selected network request outcomes
- Attention Redirector cards inserted
- visible Attention Redirector slots/cards
- failed or warning checks from the page text

Interpret the result by category:

- **Block visibility** can improve through DOM/cosmetic replacement.
- **Script/file loading** can improve through static MV3 DNR rules.
- **Script execution**, anti-adblock scriptlets, and procedural filters remain future layers.
- The tester's total score is not the product score. It is a useful roadmap signal for deciding whether to add deeper blocker layers later.

## Controlled Tester Diagnosis

Use the broader controlled-tester harness when extracting common baseline misses across test sites:

```bash
npm run diagnose:controlled-testers
npm run diagnose:controlled-testers -- --case getblockify
```

It opens Canyoublockit, GetBlockify, and Turtlecute with the unpacked extension, records interesting network outcomes, clicks GetBlockify's visible test control when present, and prints score-like text/metrics. Treat results as a baseline discovery signal: promote common network hosts, generic ad asset paths, and plain cosmetic selectors into curated seeds only when they map to normal web ad behavior.

## Live Site Eval

Use the live-site eval to automate broad coverage across real ad-heavy sites and controlled adblock test pages.

```bash
npm run eval:live:dry
npm run eval:live:discovery:dry
npm run eval:live -- --limit 5
npm run eval:live -- --group controlled
npm run eval:live -- --group discovery-stock-search
npm run eval:live -- --case tomsguide
npm run eval:live -- --url https://example.com/page --id one-off
```

Cases live in `evals/live-sites.json`. Reports are written to `runs/live-site-evals/`, which is gitignored.

The runner records:

- page load status
- Attention Redirector card/slot counts
- remaining visible ad-like suspects
- compact suspect signatures and rects
- site-risk tier/protocol classification and authored policy mismatches
- final URL and page title
- HTTP status and rendered page health

Use automation for trend detection: card counts, obvious remaining ad suspects, load errors, and controlled-test snapshots. Keep manual testing for judgment-heavy checks:

- false positives
- whether a native commerce module should count as clutter
- whether a replacement looks visually acceptable
- whether a page workflow broke

The `discovery-stock-search` group tracks image/stock search pages such as
Pexels, Unsplash, and Shutterstock. These sites often embed affiliate or
promoted image modules as first-party DOM rather than normal third-party ad
slots. Treat them as conditional live canaries: use focused reports and
host-scoped cosmetic rules when a stable wrapper is visible. Do not add global
`istockphoto.com`, Getty, Shutterstock, or broad stock-media blocking from one
case; those domains can also appear as legitimate stock/reference content.

Antigravity/Gemini discovery prompts live in `prompts/`. For a broad stock
search sweep, start with:

```bash
prompts/antigravity-stock-search-affiliate-sweep.md
```

## Manual Test Targets

Use the popup status and visual inspection. For the first proof, success means it inserts cards into obvious ad/clutter slots without breaking the page on a small manual set.

- News article page: should replace sidebar/banner ads, not article text.
- Blog page: should replace obvious ad widgets, not comments or forms.
- YouTube page: should be conservative; likely misses are acceptable.
- Reddit page: should avoid comments and normal posts; promoted slots may be replaced.
- Generic content site: should replace obvious ad-sized or sponsored containers.

## Missed Ad Reports

Use the popup's **Report missed ad** button when a banner, popup, animated rectangle, or sponsored block is missed. It opens a simple page overlay: click the missed ad, and Attention Redirector saves a compact local report and copies it for sending.

The report flow does not upload anything. Reports stay in `chrome.storage.local` and are capped at 75 recent reports.

## Diagnostic Inspector

Use the popup's Advanced **Diagnostic inspector** button for internal tuning when the simple missed-ad report is not enough.

Inspector mode:

- Highlights broader suspected clutter candidates without replacing them.
- Lets you click the small dark inspector label attached to a missed element, so the underlying ad link does not open.
- Provides **Manual pick** for missed areas that were not highlighted; turn it on, hover the area, then click to select. Manual pick places an extension capture layer over the page so ad links/iframes do not receive the click.
- Provides **Use parent** to widen a selection from a child creative to its larger container.
- Shows a compact report with tag, id/classes, size, position, z-index, text, source URLs, reasons, and safety blocks.
- Saves and copies the selected report with **Save + copy**.
- Copies the saved batch with **Export saved**.
- Clears the saved batch with **Clear saved**.
- Shows `Saved: X` in the inspector so you can confirm whether previous selections are still stored.
- Makes no remote requests and does not upload reports.

Good selector-tuning reports usually include repeated patterns, not one-off weird pages. If a copied report says `Would replace now: no`, check `Safety blocks` first. That is often the reason the release candidate skipped it.

If a report targets a very large rail or column that already contains Attention Redirector cards, it is usually too broad. Use Manual pick or Use parent/child selection to capture the smallest repeated ad slot instead of the whole rail.

## Options

The options page lets you:

- Enable or disable the extension globally.
- Set up to five local notes, or clear them all so nothing is drawn.
- Follow the system reduced-motion preference or keep cards always still.
- Add disabled domains.
- Reset to defaults.

The popup is the everyday control surface for global state, the current site, notes, missed-ad reporting, Options, and Advanced tools.

## Current Limitations

- Network blocking is intentionally static and bounded:
  - packaged DNR rules block common ad-network requests
  - current-site disable and sensitive pages use high-priority DNR allow rules
  - the blocking layer is declarative: no `webRequest` interception, no analytics,
    no remote rule service, and no access to any request body
- One exception, on YouTube only: `src/youtube-prune-main.js` wraps `fetch` and
  `XMLHttpRequest` in the page to delete `adPlacements`, `adSlots`, and
  `playerAds` from the player endpoint's *response* before the player reads it.
  Requests still leave the browser unmodified, request bodies are never read, and
  nothing is sent anywhere. It is inert on every other host.
- Cosmetic filtering is a compatibility subset:
  - supports generic and domain-scoped `##` CSS selectors
  - supports simple `#@#` selector exceptions
  - skips procedural filters, scriptlets, style rules, HTML filters, and network rules
- The generated EasyList-derived DNR snapshot is broad but mechanical; it should not be treated as mature uBlock-equivalent coverage.
- Open Shadow DOM roots can be scanned and replaced; closed shadow roots remain inaccessible and may be missed.
- No AI-generated content.
- No sync, accounts, or cloud storage.
- Container replacements preserve their original site-owned children, but
  exact visual restoration still requires a refresh. Direct media candidates
  may still be wrapped.
- Turning the extension or a site off hides existing replacement surfaces immediately, but restoring the original ad DOM still requires a refresh.
- Tide motion is active only near the viewport. Offscreen cards keep their
  static field until they approach view.

## Recommended Next Improvements

- Improve the list-update pipeline:
  - rank or curate common ad-network hosts instead of taking the first simple EasyList rules
  - keep each static DNR ruleset below the MV3 30,000-rule cap
  - keep generated rules auditable and disableable
  - continue running every cosmetic match through Attention Redirector safety checks
- Expand the local fixture page as new missed ad/popup patterns are found.
- Use inspector reports to tune safety and wrapper selection, not as the only source of ad detection truth.
- Consider per-site note overrides only if dogfooding shows global defaults are too coarse.
- Evaluate the remaining blocker stack in layers:
  - EasyPrivacy update pipeline
  - procedural cosmetic filters
  - scriptlets / anti-anti-adblock handling
  - per-site logger/debugger similar to mature blockers

Useful public references:

- EasyList: https://easylist.to/
- EasyList source: https://github.com/easylist/easylist
- uBlock Origin static filter syntax: https://github.com/gorhill/uBlock/wiki/static-filter-syntax
- uBlock Origin procedural cosmetic filters: https://github.com/gorhill/uBlock/wiki/Procedural-cosmetic-filters
- Adblock Plus filter syntax overview: https://adblockplus.org/filter-cheatsheet
