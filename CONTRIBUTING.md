# Contributing to Attention Redirector

This extension runs on every page you visit, with permission to read and modify
the DOM. A merged selector is authority over every page of every user. That one
fact decides everything below.

## The two surfaces

Some of this project is data, and data is reviewable against a test case in
minutes. The rest is an engine, and an engine change requires reasoning about
every page on the web. So they are handled differently.

### Open to pull requests

- `rules/` — declarativeNetRequest rules (`rules/rules_1.json`, `rules/easylist_dnr.json`)
- `src/cosmetic-filters.js` — cosmetic selector list
- `evals/live-sites.json` — eval cases
- `tests/fixtures/` — test fixtures

### Closed — please open an issue instead

- `src/main.js`, `src/scanner.js`, `src/replacer.js`, `src/shared.js`, `src/init.js` — the scanner, the replacer, and the safety skips
- `src/background.js` — the service worker
- `src/inspector.js` — content-script introspection and element scoring
- `src/site-policy.js` — risk tier classifier (login, checkout, payment context detection)
- `src/youtube-prune-main.js`, `src/youtube-prune-loader.js` — main-world injection
- `src/content.css` — extension-injected stylesheet bundled with the content script
- `manifest.json` — anything touching permissions
- `package.json` — CI check chain and zero-dependency constraint
- `.github/` — workflows, branch protection rules, issue templates
- `scripts/` — all deterministic guards (lints, contract test, build, packaging)
- `popup.js`, `popup.html`, `popup.css` — popup UI
- `options.js`, `options.html`, `options.css` — options page
- `welcome.js`, `welcome.html`, `welcome.css` — onboarding page

This split is not about trust. It is about what a solo maintainer can review
honestly. An engine proposal filed as an issue gets read carefully; an engine
pull request gets declined regardless of quality, so filing one wastes your time.

## Reporting rather than coding

Most useful contributions are not code.

- **A missed ad.** Open the inspector from the extension popup, click the ad that
  survived, and copy the report. It contains the element signature, the reasons
  the scanner passed on it, the safety blocks that fired, and the ancestry.
- **A false positive.** When the extension replaces something that was not an ad,
  the card's hide button offers to turn that dismissal into a report.

Both reports are generated locally and copied to your clipboard. The extension
never sends anything anywhere — you paste the report into an issue yourself,
after reading it. The URL is reduced to origin plus path before it reaches the
clipboard, with the query string and fragment dropped and their removal labeled.

## Rules for a filter pull request

1. **Every filter change ships a case.** A change to `rules/` or
   `src/cosmetic-filters.js` must also add a fixture under `tests/fixtures/` or a
   case in `evals/live-sites.json`. CI enforces this. The case is also what a
   reviewer reads to judge whether the rule is right.
2. **Cosmetic entries are plain quoted strings.** No backticks, no `${...}`, no
   concatenation. Filter text must never be able to become executable code.
3. **DNR rules block or allow, nothing else.** No `redirect`, no
   `modifyHeaders`. An `allow` rule must be scoped with `initiatorDomains` or
   `requestDomains`.
4. **Under-replace rather than break a page.** A missed ad is a worse product; a
   broken checkout is a worse outcome. When in doubt, propose the narrower rule.
5. **Keep selectors readable.** A selector nobody can audit is a selector nobody
   can remove later.

## Before you open a pull request

```bash
npm ci
npm run check
npm run test:extension
```

`npm run check` syntax-checks every script, runs the deterministic suites, and
runs the lints described above. `npm run test:extension` loads the built
extension in Chromium and proves it still starts.

Live-site evals (`npm run eval:live`) are a local command and deliberately do not
run in CI.

## Licence

GPLv3, following EasyList. By contributing you agree your work ships under it.
