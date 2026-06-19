# AGENTS.md

## Purpose

Build a small Manifest V3 Chrome Extension that blocks common ad-network
requests, visually removes obvious ad/clutter surfaces, or replaces them with a
calm Tide field and an optional user-written intention.

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
- Quiet/Anchor UI prototype: `npm run prototype:modes`
- Validate manifest JSON: `node -e "JSON.parse(require('fs').readFileSync('manifest.json', 'utf8'))"`
- Manual test: load unpacked from `chrome://extensions`

## Map

- `manifest.json` - extension manifest, DNR rulesets, popup, options, and content script registration.
- `src/background.js` - MV3 service worker for DNR ruleset toggling and per-site/sensitive-page allow rules.
- `src/cosmetic-filters.js` - conservative EasyList/uBlock-style cosmetic `##` selector parser plus local cosmetic rules.
- `src/shared.js` - shared content-script constants, settings defaults, regexes, and mutable runtime state.
- `src/main.js` - content-script initialization, settings loading, message listeners, and mutation scheduling.
- `src/inspector.js` - missed-clutter inspector UI and report capture.
- `src/scanner.js` - DOM heuristics, cosmetic matching, safety skips, and candidate inspection.
- `src/replacer.js` - replacement behavior, Tide card rendering, visual presence, and motion observer.
- `src/init.js` - content-script startup call.
- `src/content.js` - generated browser content bundle; edit the source partials, then run `npm run build`.
- `src/content.css` - injected replacement card styling.
- `popup.html`, `popup.css`, `popup.js` - browser action popup.
- `options.html`, `options.css`, `options.js` - settings UI.
- `scripts/test-extension.mjs` - Playwright extension smoke test.
- `scripts/test-cosmetic-filters.mjs` - Node smoke for cosmetic filter parsing and domain/exclusion behavior.
- `scripts/test-release-contract.mjs` - guardrail that keeps packaged DNR and per-site allow behavior in the release runtime.
- `scripts/live-eval-health.mjs` - pure page-health classification for live eval validity.
- `scripts/test-live-eval-health.mjs` - deterministic page-health regression checks.
- `scripts/test-adblock-tester.mjs` - optional live benchmark against adblock-tester.com.
- `scripts/eval-live-sites.mjs` - live-site eval runner for real ad-heavy pages and controlled test pages.
- `scripts/diagnose-live-miss.mjs` - targeted capture for supplied live misses: screenshots, frames, overlays, popups, and request hosts.
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
- `prototypes/attention-modes.html` - throwaway Ambient motion comparison with Breath, Tide, and Lumen plus Ambient/Editorial Anchor typography.
- `prototypes/attention-modes-compare.html` - side-by-side Breath/Tide/Lumen review surface with shared mode and palette controls.
- `evals/live-sites.json` - real-world and controlled URL cases for the live eval runner.
- `tests/fixtures/ad-clutter.html` - deterministic clutter/ad fixture page.
- `tests/fixtures/performance-scroll.html` - long deterministic page for sustained multi-card performance measurement.
- `package.json`, `package-lock.json` - Node scripts and Playwright dev dependency.
- `README.md` - loading, privacy, manual tests, limitations.
- `STATUS.md` - current project state.
- `DECISIONS.md` - durable implementation decisions.
- `CLAUDE.md` - Claude Code operating notes.

## Conventions

- Keep the extension dependency-free until release dogfooding proves the need for more tooling.
- Prefer conservative under-replacement over page breakage.
- Treat DNR as a bounded release layer, not a full uBlock-equivalent engine.
- Keep current-site disable and sensitive-page behavior aligned across DNR and DOM replacement.
- Any DNR change must update deterministic fixture coverage and docs in the same patch.
- Edit `src/shared.js`, `src/main.js`, `src/inspector.js`, `src/scanner.js`, `src/replacer.js`, or `src/init.js`; regenerate `src/content.js` with `npm run build`.
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
