const ERROR_TITLE_RE =
  /application error|client-side exception|server error|internal server error|access denied|this site can(?:not|'t) be reached/i;

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
