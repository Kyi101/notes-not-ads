// Runs at document_start on every page, and does one thing: if the address says
// this page is sensitive, ask the worker for the safety allow before the parser
// gets any further.
//
// The general content script runs at document_end, which is too late — by then
// the parser has already requested the scripts and stylesheets in <head>, and
// any that matched a block rule are gone with nothing to replay them. The worker
// also watches navigations, but a terminated service worker has to be woken
// before its listener runs, and that lost the race on CI while winning it on a
// warm local machine. This is the earliest point inside the page itself.
//
// Deliberately tiny. It reads no storage, parses no filters, touches no DOM, and
// stays silent on every ordinary page, because it is paying its cost on every
// page load in the browser.
(() => {
  const SENSITIVE_HOST_WORDS = [
    "bank",
    "brokerage",
    "checkout",
    "payments",
    "billing",
    "wallet"
  ];

  const SENSITIVE_PATH_RE =
    /\/(checkout|cart|basket|payment|payments|billing|invoice|invoices|pay|order|orders|purchase|subscribe|subscription|login|signin|sign-in|password|account\/security)(\/|$)/i;

  const host = location.hostname.toLowerCase().replace(/^www\./, "");
  const sensitive =
    SENSITIVE_HOST_WORDS.some((word) => host.includes(word)) ||
    SENSITIVE_PATH_RE.test(location.pathname);

  if (!sensitive) {
    return;
  }

  try {
    chrome.runtime.sendMessage({ type: "AR_SYNC_PAGE_DNR_ALLOW", allow: true }, () => {
      void chrome.runtime.lastError;
    });
  } catch (_error) {}
})();
