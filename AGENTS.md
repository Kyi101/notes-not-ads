# AGENTS.md

## Purpose

Build a small Manifest V3 Chrome Extension that blocks common ad-network
requests, visually removes obvious ad/clutter surfaces, or replaces them with a
quiet card carrying one of the user's own notes.

## Stack

- Manifest V3 Chrome Extension
- Plain HTML, CSS, and JavaScript
- No build tool
- No remote APIs
- No dependencies

## Commands

- Syntax/parser/manifest check: `npm run check`
- Full local check: `npm run check`
- Browser smoke: `npm run test:extension`
- Live external benchmark: `npm run test:adblock-tester`
- Live site eval dry run: `npm run eval:live:dry`
- Live site eval: `npm run eval:live -- --limit 5`
- Diagnose one supplied miss: `npm run diagnose:live -- https://example.com/`
- Diagnose controlled adblock testers: `npm run diagnose:controlled-testers`
- Build clean release ZIP: `npm run package:release`
- Multi-card scroll benchmark: `npm run benchmark:performance`
- Card prototype server: `npm run prototype:modes` (`/` typography, `/modes` history)
- Validate manifest JSON: `node -e "JSON.parse(require('fs').readFileSync('manifest.json', 'utf8'))"`
- Paired-change check against a base ref: `node scripts/check-paired-change.mjs --base origin/main`
- Manual test: load unpacked from `chrome://extensions`

## Map

- `manifest.json` - extension manifest, DNR rulesets, popup, options, and content script registration.
- `src/background.js` - MV3 service worker for DNR ruleset toggling and per-site/sensitive-page allow rules.
- `src/site-policy.js` - pure risk-tier classifier for future protected/standard/ad-heavy/hostile protocol routing; currently covered by deterministic tests before runtime wiring.
- `src/cosmetic-filters.js` - conservative EasyList/uBlock-style cosmetic `##` selector parser plus local cosmetic rules.
- `src/shared.js` - shared content-script constants, settings defaults, regexes, and mutable runtime state.
- `src/main.js` - content-script initialization, settings loading, message listeners, and mutation scheduling.
- `src/inspector.js` - missed-clutter inspector UI and report capture.
- `src/scanner.js` - DOM heuristics, cosmetic matching, safety skips, and candidate inspection.
- `src/replacer.js` - replacement behavior, card rendering, and the measured type scale.
- `src/init.js` - content-script startup call.
- `src/content.js` - generated browser content bundle; edit the source partials, then run `npm run build`.
- `src/youtube-prune-loader.js` - YouTube-only document-start loader that respects extension/site disable before injecting player-response pruning.
- `src/youtube-prune-main.js` - YouTube-only main-world player-response pruner for `adPlacements`, `adSlots`, and `playerAds`.
- `src/content.css` - injected replacement card styling.
- `popup.html`, `popup.css`, `popup.js` - browser action popup.
- `options.html`, `options.css`, `options.js` - settings UI.
- `scripts/test-extension.mjs` - Playwright extension smoke test.
- `scripts/test-cosmetic-filters.mjs` - Node smoke for cosmetic filter parsing and domain/exclusion behavior.
- `scripts/test-site-policy.mjs` - deterministic risk-tier classifier precedence tests.
- `scripts/test-release-contract.mjs` - guardrail that keeps packaged DNR and per-site allow behavior in the release runtime.
- `scripts/lint-cosmetic-seed.mjs` - rejects any cosmetic seed entry that is not a plain quoted string, so contributed filter text cannot become executable code.
- `scripts/test-lint-cosmetic-seed.mjs` - fixture-driven checks for the cosmetic seed lint.
- `scripts/lint-dnr-rules.mjs` - structural lint for packaged DNR rule files: unique ids, block/allow only, no degenerate filter, no unscoped allow.
- `scripts/test-lint-dnr-rules.mjs` - fixture-driven checks for the DNR rule lint.
- `scripts/check-paired-change.mjs` - fails a change that edits filter data without adding a fixture or eval case.
- `scripts/test-paired-change.mjs` - synthetic diff cases for the paired-change check.
- `scripts/test-governance-contract.mjs` - keeps CONTRIBUTING.md, CODEOWNERS, and the issue templates in sync with the open/closed contribution split.
- `scripts/live-eval-health.mjs` - pure page-health classification for live eval validity.
- `scripts/test-live-eval-health.mjs` - deterministic page-health regression checks.
- `scripts/test-adblock-tester.mjs` - optional live benchmark against adblock-tester.com.
- `scripts/eval-live-sites.mjs` - live-site eval runner for real ad-heavy pages and controlled test pages.
- `scripts/diagnose-live-miss.mjs` - targeted capture for supplied live misses: screenshots, frames, overlays, popups, and request hosts.
- `scripts/diagnose-false-positives.mjs` - FP-capture harness: records reason, signature, ancestry, original text/links/sources, and screenshots for every replaced slot on given URLs or eval cases.
- `scripts/diagnose-controlled-testers.mjs` - exploratory controlled-tester harness for Canyoublockit, GetBlockify, and Turtlecute baseline extraction.
- `scripts/package-release.mjs` - clean Git archive release ZIP builder for Chrome Web Store upload.
- `scripts/benchmark-performance.mjs` - local multi-card scroll/frame/CDP performance benchmark.
- `scripts/serve-prototype.mjs` - dependency-free local server for throwaway UI prototypes.
- `scripts/build-content.mjs` - concatenates content-script partials into `src/content.js`.
- `scripts/update-lists.mjs` - EasyList/DNR ingestion script; dry-run by default and requires `--write` before mutating generated list artifacts.
- `rules/rules_1.json` - hand-curated static DNR seed rules and local DNR smoke-test probe.
- `rules/easylist_dnr.json` - generated static DNR rules packaged with the extension.
- `docs/privacy-policy.md` - draft public privacy policy for Chrome Web Store submission.
- `docs/chrome-web-store.md` - draft store listing, permission explanations, reviewer instructions, and asset checklist.
- `docs/site-risk-policy.md` - risk-tiered blocking protocol contract for protected, standard, ad-heavy, and hostile pages.
- `prompts/antigravity-stock-search-affiliate-sweep.md` - reusable Antigravity/Gemini Flash prompt for stock/search affiliate-ad discovery reports.
- `prototypes/card-typography.html` - current card type-scale surface for the flat card.
- `prototypes/attention-modes.html` - history only: the retired Ambient motion comparison (Breath, Tide, Lumen) and the Ambient/Editorial Anchor typography pair. Every concept in it has been superseded.
- `prototypes/attention-modes-compare.html` - history only: side-by-side Breath/Tide/Lumen review surface.
- `evals/live-sites.json` - regression, discovery, controlled, and manual-only URL cases for the live eval runner, including track/category metadata and authored site-policy expectations where useful.
- `tests/fixtures/ad-clutter.html` - deterministic clutter/ad fixture page.
- `tests/fixtures/performance-scroll.html` - long deterministic page for sustained multi-card performance measurement.
- `package.json`, `package-lock.json` - Node scripts and Playwright dev dependency.
- `README.md` - loading, privacy, manual tests, limitations.
- `STATUS.md` - current project state.
- `DECISIONS.md` - durable implementation decisions.
- `CLAUDE.md` - Claude Code operating notes.
- `CONTRIBUTING.md` - the open/closed contribution split and the rules for a filter pull request.
- `SECURITY.md` - private vulnerability reporting and what counts as a vulnerability here.
- `.github/CODEOWNERS` - ownership flags on the closed engine paths only.

## Conventions

- Keep the extension dependency-free until release dogfooding proves the need for more tooling.
- Prefer conservative under-replacement over page breakage.
- Treat DNR as a bounded release layer, not a full uBlock-equivalent engine.
- Keep current-site disable and sensitive-page behavior aligned across DNR and DOM replacement.
- Any DNR change must update deterministic fixture coverage and docs in the same patch.
- Edit `src/shared.js`, `src/main.js`, `src/inspector.js`, `src/scanner.js`, `src/replacer.js`, or `src/init.js`; regenerate `src/content.js` with `npm run build`.
- The card lives inside the site's own ad container, so host CSS reaches it on two axes: properties that **inherit** down from the slot, and rules that **match the card element directly**, because `.their-wrapper div { … }` is written for the ad that used to be there and our card is now one of those divs. The second axis is the one that gets forgotten, and it is where both Forbes bugs came from. Anything new added to the card - an element, a pseudo-element, a property the design depends on - has to be added to both hostile lists in `tests/fixtures/card-matrix.html`: `HOSTILE_SLOT_CSS` for inheritance, `HOSTILE_DESCENDANT_CSS` for direct matches. A descendant entry carries a probe read off a control div, so a rule that stops matching fails loudly instead of passing empty.
- Against an ordinary host declaration, one `!important` rule in `src/content.css` wins at any specificity. Against an important one, specificity decides and the host can always outrank us, so the few properties that decide where the note sits are pinned inline in `buildCard`. Inline styles cannot address a pseudo-element, so generated content can only be fought from the stylesheet.
- `src/content.css` has a second copy inside `SHADOW_ROOT_STYLE_TEXT` in `src/shared.js`, for cards in shadow roots that author stylesheets do not reach. A card rule added to one belongs in both.
- Keep selectors readable and auditable.
- Store user settings only in `chrome.storage.local`.
- Use `scripting` only for injecting this extension's existing content script into the active tab when popup messaging finds no listener.
- Register content-script message listeners synchronously before async storage loading, so popup messages cannot race listener setup.
- Update the Map when files move or structure changes.

## What NOT to do

- Do not add React, TypeScript, bundlers, or a backend for this release candidate.
- Do not add remote APIs, analytics, accounts, or tracking.
- Do not expand into procedural filters, scriptlets, or a full adblocker stack without a specific product decision and tests.
- Do not request broad extra permissions without a specific reason.
- Do not replace navigation, forms, comments, article bodies, checkout/payment pages, text editors, Gmail, Google Docs, or banking-like pages.
