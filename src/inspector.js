function toggleInspector() {
  if (state.inspector.active) {
    stopInspector();
    return { inspectorActive: false, inspectorCandidateCount: 0 };
  }

  if (isSensitivePage()) {
    return {
      inspectorActive: false,
      inspectorCandidateCount: 0,
      inspectorError: "Inspector is skipped on sensitive pages."
    };
  }

  startInspector();
  return {
    inspectorActive: true,
    inspectorReportMode: false,
    inspectorCandidateCount: state.inspector.candidates.length
  };
}

function startMissedAdReport() {
  if (state.inspector.active && state.inspector.reportMode) {
    stopInspector();
    return {
      inspectorActive: false,
      inspectorReportMode: false,
      inspectorCandidateCount: 0
    };
  }

  if (state.inspector.active) {
    stopInspector();
  }

  if (isSensitivePage()) {
    return {
      inspectorActive: false,
      inspectorReportMode: false,
      inspectorCandidateCount: 0,
      inspectorError: "Report flow is skipped on sensitive pages."
    };
  }

  startInspector({ reportMode: true, manualPick: true });
  return {
    inspectorActive: true,
    inspectorReportMode: true,
    inspectorCandidateCount: state.inspector.candidates.length
  };
}

function startInspector(options = {}) {
  if (state.inspector.active || !document.documentElement) {
    return;
  }

  state.inspector.active = true;
  state.inspector.reportMode = Boolean(options.reportMode);
  state.inspector.manualPick = Boolean(options.manualPick);
  state.inspector.overlay = buildInspectorOverlay();
  document.documentElement.appendChild(state.inspector.overlay);

  state.inspector.clickHandler = handleInspectorClick;
  state.inspector.pointerMoveHandler = handleInspectorPointerMove;
  state.inspector.refreshHandler = scheduleInspectorRefresh;

  document.addEventListener("click", state.inspector.clickHandler, true);
  document.addEventListener("pointermove", state.inspector.pointerMoveHandler, true);
  window.addEventListener("scroll", state.inspector.refreshHandler, true);
  window.addEventListener("resize", state.inspector.refreshHandler);

  refreshInspector();
  if (state.inspector.manualPick) {
    ensureManualCaptureLayer();
    updateInspectorOverlay();
  }
}

function stopInspector() {
  if (!state.inspector.active) {
    return;
  }

  document.removeEventListener("click", state.inspector.clickHandler, true);
  document.removeEventListener("pointermove", state.inspector.pointerMoveHandler, true);
  window.removeEventListener("scroll", state.inspector.refreshHandler, true);
  window.removeEventListener("resize", state.inspector.refreshHandler);
  window.clearTimeout(state.inspector.refreshTimer);
  clearInspectorBoxes();
  clearManualHoverBox();

  if (state.inspector.overlay) {
    state.inspector.overlay.remove();
  }

  state.inspector.active = false;
  state.inspector.overlay = null;
  state.inspector.candidates = [];
  state.inspector.selectedInfo = null;
  state.inspector.manualPick = false;
  state.inspector.reportMode = false;
  clearManualCaptureLayer();
  state.inspector.hoverBox = null;
  state.inspector.hoverInfo = null;
  state.inspector.clickHandler = null;
  state.inspector.pointerMoveHandler = null;
  state.inspector.refreshHandler = null;
}

function buildInspectorOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "attention-redirector-inspector";
  overlay.dataset.attentionRedirectorReportMode = String(
    state.inspector.reportMode
  );

  const header = document.createElement("div");
  header.className = "attention-redirector-inspector__header";

  const titleBlock = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = state.inspector.reportMode
    ? "Report missed ad"
    : "Diagnostic inspector";
  const subtitle = document.createElement("span");
  subtitle.textContent = state.inspector.reportMode
    ? "Click the missed ad. A local report will be copied."
    : "Click a missed banner, popup, or animated slot.";
  titleBlock.append(title, subtitle);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", stopInspector);

  header.append(titleBlock, closeButton);

  const summary = document.createElement("p");
  summary.className = "attention-redirector-inspector__summary";
  summary.dataset.attentionRedirectorInspectorSummary = "true";

  const details = document.createElement("pre");
  details.className = "attention-redirector-inspector__details";
  details.dataset.attentionRedirectorInspectorDetails = "true";

  const actions = document.createElement("div");
  actions.className = "attention-redirector-inspector__actions";

  const refreshButton = document.createElement("button");
  refreshButton.type = "button";
  refreshButton.textContent = "Refresh highlights";
  refreshButton.addEventListener("click", refreshInspector);

  const manualPickButton = document.createElement("button");
  manualPickButton.type = "button";
  manualPickButton.textContent = "Manual pick";
  manualPickButton.dataset.attentionRedirectorManualPick = "true";
  manualPickButton.addEventListener("click", toggleManualPick);

  const parentButton = document.createElement("button");
  parentButton.type = "button";
  parentButton.textContent = "Use parent";
  parentButton.addEventListener("click", selectInspectorParent);

  const saveCopyButton = document.createElement("button");
  saveCopyButton.type = "button";
  saveCopyButton.textContent = "Save + copy";
  saveCopyButton.addEventListener("click", saveAndCopyInspectorReport);

  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.textContent = "Export saved";
  exportButton.addEventListener("click", copySavedInspectorReports);

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.textContent = "Clear saved";
  clearButton.addEventListener("click", clearSavedInspectorReports);

  const copyStatus = document.createElement("span");
  copyStatus.dataset.attentionRedirectorInspectorCopyStatus = "true";

  const savedCount = document.createElement("span");
  savedCount.className = "attention-redirector-inspector__saved-count";
  savedCount.dataset.attentionRedirectorSavedCount = "true";
  savedCount.textContent = "Saved: checking";

  if (state.inspector.reportMode) {
    saveCopyButton.textContent = "Copy report";
    actions.append(saveCopyButton, copyStatus, savedCount);
  } else {
    actions.append(
      refreshButton,
      manualPickButton,
      parentButton,
      saveCopyButton,
      exportButton,
      clearButton,
      copyStatus,
      savedCount
    );
  }
  overlay.append(header, summary, details, actions);
  return overlay;
}

function scheduleInspectorRefresh() {
  if (!state.inspector.active) {
    return;
  }

  window.clearTimeout(state.inspector.refreshTimer);
  state.inspector.refreshTimer = window.setTimeout(refreshInspector, 120);
}

function refreshInspector() {
  if (!state.inspector.active) {
    return;
  }

  clearInspectorBoxes();
  state.inspector.candidates = collectInspectorCandidates();
  renderInspectorBoxes();

  if (state.inspector.selectedInfo) {
    state.inspector.selectedInfo = inspectElement(
      state.inspector.selectedInfo.element,
      ["manual click"]
    );
    renderSelectedBox(state.inspector.selectedInfo);
  }

  updateInspectorOverlay();
  updateSavedReportCount();
}

function clearInspectorBoxes() {
  state.inspector.boxes.forEach((box) => box.remove());
  state.inspector.boxes = [];
}

function collectInspectorCandidates() {
  const records = [];
  const seen = new Set();
  const nodes = Array.from(document.querySelectorAll(DEBUG_SCAN_SELECTOR));

  for (const node of nodes) {
    const element = getCandidateElement(node);
    if (!element || seen.has(element) || isExtensionElement(element)) {
      continue;
    }

    const info = inspectElement(element);
    if (info.score < 3) {
      continue;
    }

    records.push(info);
    seen.add(element);
  }

  return dedupeInspectorRecords(records).slice(0, INSPECTOR_MAX_HIGHLIGHTS);
}

function dedupeInspectorRecords(records) {
  const selected = [];
  const sorted = records.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.rect.area - b.rect.area;
  });

  for (const record of sorted) {
    const overlapsExisting = selected.some((item) => {
      return (
        item.element.contains(record.element) ||
        record.element.contains(item.element)
      );
    });

    if (!overlapsExisting) {
      selected.push(record);
    }
  }

  return selected.sort((a, b) => {
    if (Math.abs(a.rect.top - b.rect.top) > 20) {
      return a.rect.top - b.rect.top;
    }
    return a.rect.left - b.rect.left;
  });
}

function renderInspectorBoxes() {
  state.inspector.candidates.forEach((info, index) => {
    const box = buildInspectorBox(info, `#${index + 1}`);
    const label = box.querySelector(".attention-redirector-inspector-box__label");
    if (label) {
      label.dataset.attentionRedirectorIndex = String(index);
    }
    document.documentElement.appendChild(box);
    state.inspector.boxes.push(box);
  });
}

function renderSelectedBox(info) {
  const box = buildInspectorBox(info, "selected");
  box.classList.add("attention-redirector-inspector-box--selected");
  const label = box.querySelector(".attention-redirector-inspector-box__label");
  if (label) {
    label.dataset.attentionRedirectorSelected = "true";
  }
  document.documentElement.appendChild(box);
  state.inspector.boxes.push(box);
}

function buildInspectorBox(info, labelText) {
  const box = document.createElement("div");
  box.className = "attention-redirector-inspector-box";
  box.style.top = `${Math.max(0, Math.round(info.rect.top))}px`;
  box.style.left = `${Math.max(0, Math.round(info.rect.left))}px`;
  box.style.width = `${Math.max(1, Math.round(info.rect.width))}px`;
  box.style.height = `${Math.max(1, Math.round(info.rect.height))}px`;

  const label = document.createElement("span");
  label.className = "attention-redirector-inspector-box__label";
  label.textContent = `${labelText} ${info.reasons.slice(0, 2).join(", ")}`;
  box.append(label);
  return box;
}

function handleInspectorClick(event) {
  if (!state.inspector.active) {
    return;
  }

  const inspectorBox =
    event.target instanceof Element
      ? event.target.closest(".attention-redirector-inspector-box")
      : null;
  if (inspectorBox) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
    const label =
      event.target instanceof Element
        ? event.target.closest(".attention-redirector-inspector-box__label")
        : null;
    if (label) {
      const index = Number.parseInt(label.dataset.attentionRedirectorIndex, 10);
      if (Number.isFinite(index) && state.inspector.candidates[index]) {
        selectInspectorCandidate(state.inspector.candidates[index]);
        if (state.inspector.reportMode) {
          saveAndCopyInspectorReport({ auto: true });
        }
      } else if (
        label.dataset.attentionRedirectorSelected === "true" &&
        state.inspector.selectedInfo
      ) {
        selectInspectorCandidate(state.inspector.selectedInfo);
        if (state.inspector.reportMode) {
          saveAndCopyInspectorReport({ auto: true });
        }
      }
    }
    return;
  }

  if (
    event.target instanceof Element &&
    event.target.closest(".attention-redirector-inspector")
  ) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === "function") {
    event.stopImmediatePropagation();
  }

  const element = state.inspector.manualPick
    ? getInspectableElementAtPoint(event.clientX, event.clientY)
    : getInspectableElement(event.target);
  if (!element) {
    return;
  }

  selectInspectorCandidate(
    inspectElement(element, [
      state.inspector.manualPick ? "manual pick" : "manual click"
    ])
  );
  if (state.inspector.reportMode) {
    saveAndCopyInspectorReport({ auto: true });
  }
  if (state.inspector.manualPick) {
    state.inspector.manualPick = false;
    clearManualCaptureLayer();
    clearManualHoverBox();
    updateInspectorOverlay();
  }
}

function selectInspectorCandidate(info) {
  const manualReasons = info.reasons.filter((reason) => {
    return reason.startsWith("manual ");
  });
  state.inspector.selectedInfo = inspectElement(
    info.element,
    manualReasons.length ? manualReasons : ["manual click"]
  );
  refreshInspector();
}

function getInspectableElement(target) {
  return pickBestInspectableElement([target]);
}

function getInspectableElementAtPoint(x, y) {
  const capture = state.inspector.manualCapture;
  const previousPointerEvents = capture ? capture.style.pointerEvents : "";

  if (capture) {
    capture.style.pointerEvents = "none";
  }

  const elements = document.elementsFromPoint(x, y);

  if (capture) {
    capture.style.pointerEvents = previousPointerEvents;
  }

  return pickBestInspectableElement(elements);
}

function pickBestInspectableElement(targets) {
  const records = [];
  const seen = new Set();

  targets.forEach((target, stackIndex) => {
    if (!(target instanceof HTMLElement) || isExtensionElement(target)) {
      return;
    }

    let current = target;
    let depth = 0;

    while (current && current !== document.body && depth < 9) {
      if (current instanceof HTMLElement && !isExtensionElement(current)) {
        addInspectableRecord(records, seen, current, stackIndex, depth);
        const wrapper = promoteToAdWrapper(current);
        if (wrapper && wrapper !== current) {
          addInspectableRecord(records, seen, wrapper, stackIndex, depth - 0.5);
        }
      }

      current = current.parentElement;
      depth += 1;
    }
  });

  records.sort((a, b) => b.score - a.score);
  return records.length ? records[0].element : null;
}

function addInspectableRecord(records, seen, element, stackIndex, depth) {
  if (seen.has(element)) {
    return;
  }

  const rect = element.getBoundingClientRect();
  if (!isVisibleRect(rect) || isTooLargeForInspector(rect, element)) {
    return;
  }

  seen.add(element);
  records.push({
    element,
    score: getInspectableElementScore(element, stackIndex, depth)
  });
}

function getInspectableElementScore(element, stackIndex, depth) {
  const info = inspectElement(element);
  const rect = element.getBoundingClientRect();
  let score = info.score;
  const strongAdSignal = hasStrongAdSignal(element);

  if (isAdWrapperCandidate(element)) {
    score += 8;
  }

  if (strongAdSignal) {
    score += 5;
  }

  if (getMatchReason(element)) {
    score += 4;
  }

  if (rect.width >= 120 && rect.height >= 60) {
    score += 1;
  }

  const isBroadGenericAncestor =
    element.matches("main,article,aside,section") &&
    rect.width * rect.height > 180000 &&
    !isAdWrapperCandidate(element);

  if (isBroadGenericAncestor) {
    score -= 14;
  } else if (!strongAdSignal && rect.width * rect.height > 180000) {
    score -= 8;
  }

  return score - stackIndex * 0.35 - depth * 1.15;
}

function updateInspectorOverlay() {
  const summary = state.inspector.overlay.querySelector(
    "[data-attention-redirector-inspector-summary]"
  );
  const details = state.inspector.overlay.querySelector(
    "[data-attention-redirector-inspector-details]"
  );
  const manualPickButton = state.inspector.overlay.querySelector(
    "[data-attention-redirector-manual-pick]"
  );

  if (state.inspector.reportMode) {
    summary.textContent = state.inspector.manualPick
      ? "Click directly on the missed ad. Nothing is sent automatically."
      : "Report selected. Use Copy report again if your clipboard missed it.";
    details.textContent = state.inspector.selectedInfo
      ? "Report copied locally. Paste it into feedback or an issue when you send it."
      : "Click the missed ad on the page. The report includes page URL, element size, source, and safety reason.";
  } else {
    summary.textContent = state.inspector.manualPick
      ? "Manual pick is on. Hover a missed area, then click to select it."
      : `${state.inspector.candidates.length} suspects highlighted. Normal replacement is still conservative.`;
    details.textContent = state.inspector.selectedInfo
      ? formatElementReport(state.inspector.selectedInfo, "Selected element")
      : "Click a dark inspector label, or use Manual pick for anything not highlighted.";
  }

  if (manualPickButton) {
    manualPickButton.textContent = state.inspector.manualPick
      ? "Stop manual"
      : "Manual pick";
    manualPickButton.classList.toggle(
      "attention-redirector-inspector__button--active",
      state.inspector.manualPick
    );
  }
}

function toggleManualPick() {
  state.inspector.manualPick = !state.inspector.manualPick;

  if (state.inspector.manualPick) {
    ensureManualCaptureLayer();
  } else {
    clearManualCaptureLayer();
    clearManualHoverBox();
  }

  updateInspectorOverlay();
}

function handleInspectorPointerMove(event) {
  if (!state.inspector.active || !state.inspector.manualPick) {
    return;
  }

  if (
    event.target instanceof Element &&
    event.target.closest(".attention-redirector-inspector")
  ) {
    return;
  }

  const element = getInspectableElementAtPoint(event.clientX, event.clientY);
  if (!element) {
    clearManualHoverBox();
    return;
  }

  state.inspector.hoverInfo = inspectElement(element, ["manual hover"]);
  renderManualHoverBox(state.inspector.hoverInfo);
}

function renderManualHoverBox(info) {
  if (!state.inspector.hoverBox) {
    state.inspector.hoverBox = document.createElement("div");
    state.inspector.hoverBox.className = "attention-redirector-manual-hover";
    const label = document.createElement("span");
    state.inspector.hoverBox.append(label);
    document.documentElement.appendChild(state.inspector.hoverBox);
  }

  state.inspector.hoverBox.style.top = `${Math.max(
    0,
    Math.round(info.rect.top)
  )}px`;
  state.inspector.hoverBox.style.left = `${Math.max(
    0,
    Math.round(info.rect.left)
  )}px`;
  state.inspector.hoverBox.style.width = `${Math.max(
    1,
    Math.round(info.rect.width)
  )}px`;
  state.inspector.hoverBox.style.height = `${Math.max(
    1,
    Math.round(info.rect.height)
  )}px`;
  state.inspector.hoverBox.querySelector("span").textContent =
    `manual ${info.signature}`;
}

function ensureManualCaptureLayer() {
  if (state.inspector.manualCapture) {
    return;
  }

  const capture = document.createElement("div");
  capture.className = "attention-redirector-manual-capture";
  if (state.inspector.overlay && state.inspector.overlay.parentElement) {
    state.inspector.overlay.parentElement.insertBefore(
      capture,
      state.inspector.overlay
    );
  } else {
    document.documentElement.appendChild(capture);
  }
  state.inspector.manualCapture = capture;
}

function clearManualCaptureLayer() {
  if (state.inspector.manualCapture) {
    state.inspector.manualCapture.remove();
  }

  state.inspector.manualCapture = null;
}

function clearManualHoverBox() {
  if (state.inspector.hoverBox) {
    state.inspector.hoverBox.remove();
  }

  state.inspector.hoverBox = null;
  state.inspector.hoverInfo = null;
}

function selectInspectorParent() {
  if (!state.inspector.selectedInfo) {
    setInspectorStatus("Select something first.");
    return;
  }

  const parent = findInspectableParent(state.inspector.selectedInfo.element);
  if (!parent) {
    setInspectorStatus("No useful parent found.");
    return;
  }

  selectInspectorCandidate(inspectElement(parent, ["manual parent"]));
}

function findInspectableParent(element) {
  let current = element.parentElement;

  while (current && current !== document.body) {
    if (
      current instanceof HTMLElement &&
      !isExtensionElement(current) &&
      isVisibleRect(current.getBoundingClientRect()) &&
      !isTooLargeForInspector(current.getBoundingClientRect(), current)
    ) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

function setInspectorStatus(message) {
  const status = state.inspector.overlay.querySelector(
    "[data-attention-redirector-inspector-copy-status]"
  );

  if (!status) {
    return;
  }

  status.textContent = message;
  window.setTimeout(() => {
    status.textContent = "";
  }, 1600);
}

async function saveAndCopyInspectorReport(options = {}) {
  const status = state.inspector.overlay.querySelector(
    "[data-attention-redirector-inspector-copy-status]"
  );

  if (!state.inspector.selectedInfo) {
    status.textContent = "Click a missed item first.";
    return;
  }

  const record = createInspectorReportRecord(state.inspector.selectedInfo);

  try {
    const savedCount = await saveInspectorReport(record);
    await copyText(record.text);
    status.textContent = options.auto
      ? `Report copied (${savedCount}).`
      : `Saved + copied (${savedCount}).`;
    updateSavedReportCount(savedCount);
  } catch (_error) {
    status.textContent = "Save/copy failed.";
  }

  window.setTimeout(() => {
    status.textContent = "";
  }, 1600);
}

async function copySavedInspectorReports() {
  const status = state.inspector.overlay.querySelector(
    "[data-attention-redirector-inspector-copy-status]"
  );
  const reports = await loadInspectorReports();

  if (!reports.length) {
    status.textContent = "No saved reports.";
    return;
  }

  try {
    await copyText(formatSavedInspectorReports(reports));
    status.textContent = `Copied ${reports.length} saved.`;
  } catch (_error) {
    status.textContent = "Export failed.";
  }

  window.setTimeout(() => {
    status.textContent = "";
  }, 1600);
}

async function clearSavedInspectorReports() {
  const status = state.inspector.overlay.querySelector(
    "[data-attention-redirector-inspector-copy-status]"
  );
  await saveInspectorReports([]);
  status.textContent = "Cleared saved.";
  updateSavedReportCount(0);

  window.setTimeout(() => {
    status.textContent = "";
  }, 1600);
}

function createInspectorReportRecord(info) {
  const createdAt = new Date().toISOString();
  const inferredType = inferClutterType(info);
  const record = {
    id: `${Date.now()}-${hashString(`${location.href}:${info.signature}`)}`,
    createdAt,
    url: formatReportUrl(location.href),
    hostname: location.hostname,
    title: document.title,
    inferredType,
    signature: info.signature,
    text: formatSelectedInspectorReport(info, {
      createdAt,
      inferredType
    })
  };

  return record;
}

function inferClutterType(info) {
  const reasonText = info.reasons.join(" ").toLowerCase();
  const signature = info.signature.toLowerCase();
  const rect = info.rect;

  if (reasonText.includes("popup") || info.css.position === "fixed") {
    return "sticky popup / fixed overlay";
  }

  if (reasonText.includes("animated")) {
    return "animated rectangle";
  }

  if (reasonText.includes("sidebar") || rect.width <= 360) {
    return "sidebar rectangle";
  }

  if (signature.includes("sponsor") || reasonText.includes("sponsor")) {
    return "sponsored/native block";
  }

  if (rect.width >= 600 && rect.height <= 140) {
    return "top/banner slot";
  }

  return "missed clutter";
}

function formatSelectedInspectorReport(info, context) {
  return [
    "Notturn Missed Clutter Report",
    `Generated: ${context.createdAt}`,
    `Page: ${formatReportUrl(location.href)}`,
    `Host: ${location.hostname}`,
    `Title: ${document.title}`,
    `Inferred type: ${context.inferredType}`,
    "",
    formatElementReport(info, "Clicked element")
  ].join("\n");
}

function formatSavedInspectorReports(reports) {
  const lines = [
    "Notturn Saved Inspector Reports",
    `Exported: ${new Date().toISOString()}`,
    `Count: ${reports.length}`
  ];

  reports.forEach((record, index) => {
    lines.push(
      "",
      `--- Report ${index + 1} / ${reports.length} ---`,
      record.text
    );
  });

  return lines.join("\n");
}

async function saveInspectorReport(record) {
  const reports = await loadInspectorReports();
  const withoutDuplicate = reports.filter((item) => {
    return !(
      item.url === record.url &&
      item.signature === record.signature &&
      item.inferredType === record.inferredType
    );
  });
  const nextReports = [record, ...withoutDuplicate].slice(
    0,
    INSPECTOR_MAX_SAVED_REPORTS
  );

  await saveInspectorReports(nextReports);
  return nextReports.length;
}

function loadInspectorReports() {
  return new Promise((resolve) => {
    chrome.storage.local.get(INSPECTOR_REPORTS_KEY, (items) => {
      const reports = Array.isArray(items[INSPECTOR_REPORTS_KEY])
        ? items[INSPECTOR_REPORTS_KEY]
        : [];
      resolve(reports);
    });
  });
}

function saveInspectorReports(reports) {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      {
        [INSPECTOR_REPORTS_KEY]: reports
      },
      resolve
    );
  });
}

async function updateSavedReportCount(knownCount) {
  if (!state.inspector.active || !state.inspector.overlay) {
    return;
  }

  const countNode = state.inspector.overlay.querySelector(
    "[data-attention-redirector-saved-count]"
  );

  if (!countNode) {
    return;
  }

  const count =
    typeof knownCount === "number"
      ? knownCount
      : (await loadInspectorReports()).length;

  countNode.textContent = `Saved: ${count}`;
}

async function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function formatInspectorReport() {
  const lines = [
    "Notturn Inspector Report",
    `Generated: ${new Date().toISOString()}`,
    `Page: ${formatReportUrl(location.href)}`,
    `Title: ${document.title}`,
    "",
    state.inspector.selectedInfo
      ? formatElementReport(state.inspector.selectedInfo, "Selected element")
      : "Selected element: none",
    "",
    `Top highlighted suspects: ${Math.min(
      state.inspector.candidates.length,
      INSPECTOR_MAX_REPORT_CANDIDATES
    )}`
  ];

  state.inspector.candidates
    .slice(0, INSPECTOR_MAX_REPORT_CANDIDATES)
    .forEach((info, index) => {
      lines.push("", formatElementReport(info, `Suspect #${index + 1}`));
    });

  return lines.join("\n");
}

function formatElementReport(info, heading) {
  return [
    `${heading}: ${info.signature}`,
    `Reasons: ${info.reasons.join(", ") || "none"}`,
    `Would replace now: ${info.wouldReplace ? "yes" : "no"}`,
    `Safety blocks: ${info.safetyBlocks.join(", ") || "none"}`,
    `Score: ${info.score}`,
    `Rect: ${Math.round(info.rect.width)}x${Math.round(info.rect.height)} at ${Math.round(
      info.rect.left
    )},${Math.round(info.rect.top)} area=${Math.round(info.rect.area)}`,
    `CSS: position=${info.css.position} z-index=${info.css.zIndex} display=${info.css.display} opacity=${info.css.opacity}`,
    `Role/label: ${info.role || "none"} / ${info.ariaLabel || "none"}`,
    `Text: ${info.textSnippet || "none"}`,
    `Sources: ${info.sources.join(" | ") || "none"}`,
    `Ancestry: ${info.ancestry.join(" > ")}`
  ].join("\n");
}
