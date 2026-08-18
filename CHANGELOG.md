# Changelog

## 1.0.1 — 2026-08

Fixes the extension breaking the dashboards of the services it blocks.

- Whole-host block rules for services that also have a product console —
  Google Analytics, Sentry, Mixpanel, Amplitude, Hotjar, the TikTok and
  Pinterest ad managers, and two dozen more — now block third-party requests
  only. The console's own pages work again; tracking hits sent from other
  sites stay blocked. Verified against Chrome's own rule matcher across 48
  consoles, with regression cases proving the third-party blocking is intact.
- Scoped allow rules carve consoles out of the generated EasyList ruleset,
  including the AdMob console's calls to its API on a different domain.
- Note replacement is additionally disabled on those console domains, since
  dashboard UIs are full of ad-related class names that read as ad evidence.

## 1.0.0 — 2026-08

First public release.

- Blocks common ad and tracker requests with packaged Manifest V3
  `declarativeNetRequest` static rules: a hand-curated seed set plus a generated
  set derived from EasyList, kept under the MV3 rule cap.
- Finds likely ad and clutter containers left in the page and replaces each with
  a flat card carrying one of up to five notes the user wrote. With no notes
  saved, the surfaces are removed and the page closes over them instead.
- Conservative safety model: whole domains where the extension does nothing at
  all, product and app surfaces where request blocking stays on but nothing in
  the page is replaced, and in-page guards that keep it out of navigation,
  headers, footers, forms, comments, article bodies, editors, and menus.
- Supports a subset of standard cosmetic filter syntax. Procedural filters,
  scriptlets, and anti-adblock countermeasures are out of scope.
- A YouTube-specific layer removes ad entries from the player's own data.
- Local missed-ad reporting and a page inspector. Reports are saved locally and
  never uploaded.
- No accounts, analytics, telemetry, remote rules, or remotely hosted code.
