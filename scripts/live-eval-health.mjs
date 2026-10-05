const ERROR_TITLE_RE =
  /application error|client-side exception|server error|internal server error|access denied|this site can(?:not|'t) be reached/i;

// Passed directly to page.evaluate. innerText can include hidden loading text
// or fall back to textContent on a hidden body; neither proves a usable page.
// Stop once enough rendered text establishes that the page is not blank.
export function measureReadableText() {
  if (!document.body) return 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const visible = new WeakMap();
  function isVisible(element) {
    if (!element) return true;
    if (visible.has(element)) return visible.get(element);
    const style = getComputedStyle(element);
    const result = !element.matches("script,style,noscript,template") &&
      style.display !== "none" && style.visibility === "visible" &&
      Number.parseFloat(style.opacity || "1") > 0 && isVisible(element.parentElement);
    visible.set(element, result);
    return result;
  }
  let length = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent.trim();
    if (!text || !isVisible(node.parentElement)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    if ([...range.getClientRects()].some((rect) => rect.width > 0 && rect.height > 0)) {
      length += text.length;
      if (length >= 1000) break;
    }
  }
  return length;
}

export function assessPageHealth({ httpStatus, title, bodyTextLength }) {
  if (Number.isFinite(httpStatus) && httpStatus >= 400) {
    return {
      code: "http-status",
      message: `Page returned HTTP ${httpStatus}.`
    };
  }

  const normalizedTitle = String(title || "").trim();
  if (ERROR_TITLE_RE.test(normalizedTitle)) {
    return {
      code: "error-title",
      message: `Page rendered an error state: ${normalizedTitle}`
    };
  }

  if (Number(bodyTextLength) === 0) {
    return {
      code: "empty-body",
      message: "Page rendered no readable body text."
    };
  }

  return null;
}
