# Security Policy

Notes Not Ads runs on every page the user visits and can read and modify
the DOM. A vulnerability here is a vulnerability in a privileged runtime, so it
must not arrive as a public issue.

## Reporting a vulnerability

Use GitHub private vulnerability reporting:

https://github.com/Kyi101/notes-not-ads/security/advisories/new

That channel is private until an advisory is published. Please do not open a
public issue, and please do not open a pull request that demonstrates the
problem — a public patch is a public disclosure.

Include what you would need yourself: the page or fixture that triggers it, the
extension version from `manifest.json`, the browser version, and what an attacker
gets.

## What counts

- Anything that lets page content or filter-list content execute as extension code.
- Anything that leaks browsing data out of the extension. The extension makes no
  network requests of its own, so any outbound traffic is a finding.
- Anything that lets a page bypass the safety skips for login, checkout, payment,
  or password contexts.
- Anything in a packaged rule file that unblocks a tracker rather than blocking one.

## What does not

A missed ad is not a vulnerability, and neither is a false positive. Both are
ordinary issues, and both have templates.

## Scope

Only the code in this repository. Upstream filter lists are packaged, not
authored here; report list problems upstream and open an issue here so the
packaged snapshot gets updated.
