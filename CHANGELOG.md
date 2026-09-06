# Changelog

## Unreleased

Stops the extension replacing the content of classifieds listings.

- A bare `ad` or `ads` token in an element's id, class or `data-testid` is no
  longer enough on its own to replace a container. It now needs a second signal:
  a creative from an ad host, a slot caption, a standard creative size, a
  script-written iframe, an explicit `data-ad`, an unambiguous wrapper above it,
  or an empty container — the shape a slot takes once the creative is blocked.
  `advert`, `adsbygoogle`, `dfp`, `doubleclick` and the rest are unchanged.
- On a classifieds site the user's own listing is an ad and the markup says so.
  An OLX item page had its photo gallery, spec table, description, footer bar,
  price-and-contact-seller box and every similar-listing tile replaced. The
  homepage and search grids were unaffected, so this only appeared when someone
  opened an item directly.
- OLX is additionally on the list of domains where nothing in the page is
  replaced. Request blocking there is unchanged.
- Measured against the 21-site regression track: one slot lost, on Bleacher
  Report, and it may be run-to-run ad variance.

## 1.0.2 — 2026-08

Makes request blocking reliable when another filtering extension is already
installed.

- Keeps the combined packaged DNR rules at 29,000: Chrome's guaranteed 30,000
  static-rule allowance, with 1,000 reserved for per-site and per-tab session
  rules. The previous 57,104-rule build could be refused as a whole when the
  browser-wide overflow pool was already occupied, leaving blocking silently
  disabled.
- Ranks EasyList rules using hosts observed by this project's live evals and
  broader web prevalence. The unmeasured tail is spread deterministically
  across the list instead of cut at an alphabetical boundary.
- Treats each host's blocks and scoped exceptions as one dependency group, so
  shrinking can drop a block safely but can never keep it after dropping the
  exception that prevents site breakage.
- A full 25-site before/after eval found no measurable loss: every per-site
  card, slot, suspect, caption, health, and policy metric was unchanged, and
  the dedicated AdBlock Tester score remained 97/100.

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
