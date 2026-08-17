# Notes Not Ads Privacy Policy

Effective date: August 17, 2026

Notes Not Ads is designed to run locally in your browser. The extension
does not create an account, does not include analytics, and does not send your
browsing activity, settings, notes, or diagnostic reports to the developer.

## Data Collection

Notes Not Ads does not collect, sell, share, or transmit user data to the
developer.

The extension stores settings locally in Chrome's extension storage, including:

- whether the extension is enabled
- your notes
- theme preference
- disabled site domains
- locally saved inspector reports, if you choose to save them

These values remain on your device unless you manually copy, export, remove, or
reset them.

## Your Notes Are Visible To The Page You Are Reading

A replacement card is a real element inserted into the page you are visiting, so
the note it carries can be read by that page's own scripts, exactly like any
other text on the page. The extension sends nothing anywhere, but a note shown
on a site is not private from that site. Keep anything sensitive out of your
note rotation.

## Browser Activity

Notes Not Ads needs access to normal webpages so it can detect likely ad
and clutter surfaces, replace or collapse them, and block common ad/tracker
requests with packaged static rules.

The extension does not send browsing history to the developer. It does not use a
remote rule service and does not upload page contents.

## Missed-Ad And Inspector Reports

The missed-ad report flow and diagnostic inspector can save a compact local
report about an element on the page, including selector-like details, size,
position, source URLs, and safety checks. Reports are stored locally in Chrome
extension storage and are not uploaded. If you choose to copy or share a report
manually, you control where it goes.

## Network Requests

During normal browsing, the extension runtime does not make remote requests of
its own. It may block browser requests to common ad, tracker, analytics, and
error-monitoring domains using packaged Manifest V3 declarativeNetRequest rules.

Developer-only scripts in the source repository can fetch public filter lists
for local development, but those scripts are not run by the installed extension
during normal browsing.

## Permissions

Notes Not Ads uses these Chrome permissions:

- `storage`: save local settings and optional local inspector reports
- `activeTab`: let the popup communicate with the current tab after you open it
- `scripting`: inject the existing content script into an already-open tab when
  the popup cannot reach it
- `declarativeNetRequest`: block packaged ad/tracker request rules and install
  allow rules for disabled or sensitive pages
- `http://*/*` and `https://*/*`: inspect and replace likely ad/clutter surfaces
  on normal webpages

On YouTube only, the extension additionally runs a dedicated content script and
injects a page-level (main-world) script, declared as a web-accessible
resource, that removes ad entries from YouTube's own player data so video ads
do not play. This script runs entirely locally, sends no data anywhere, and is
not injected when the extension is disabled globally or for YouTube.

## Future Changes

If Notes Not Ads ever adds optional reporting or telemetry, it must be
explicitly user-triggered, disclosed in the product UI, and reflected in an
updated privacy policy before release.

## Contact

hlib@kyii.studio
