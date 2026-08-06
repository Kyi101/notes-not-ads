const STORAGE_KEY = "attentionRedirectorSettings";
const CONTENT_SCRIPT_FILES = ["src/cosmetic-filters.js", "src/content.js"];
const CONTENT_STYLE_FILES = ["src/content.css"];
const DEFAULT_ANCHOR_NOTE = "Finish what deserves your attention.";
const MAX_ANCHOR_NOTES = 5;

const DEFAULT_SETTINGS = {
  enabled: true,
  anchorNote: DEFAULT_ANCHOR_NOTE,
  anchorNotes: [DEFAULT_ANCHOR_NOTE],
  reducedMotion: "system",
  themePreference: "system",
  disabledDomains: []
};

const globalToggle = document.getElementById("globalToggle");
const siteToggle = document.getElementById("siteToggle");
const siteLabel = document.getElementById("siteLabel");
const anchorNotesContainer = document.getElementById("anchorNotes");
const addAnchorMessageButton = document.getElementById("addAnchorMessage");
const anchorCount = document.getElementById("anchorCount");
const reportMissedAdButton = document.getElementById("reportMissedAd");
const replaceNowButton = document.getElementById("replaceNow");
const inspectClutterButton = document.getElementById("inspectClutter");
const openOptionsButton = document.getElementById("openOptions");
const statusText = document.getElementById("statusText");

let activeTab = null;
let activeDomain = "";
let settings = { ...DEFAULT_SETTINGS };
let noteDrafts = [DEFAULT_ANCHOR_NOTE];
let inspectorActive = false;
let inspectorReportMode = false;
let saveTimer = 0;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  settings = await loadSettings();
  applyTheme(settings.themePreference);
  activeTab = await getActiveTab();
  activeDomain = getDomainFromTab(activeTab);
  noteDrafts = normalizeAnchorNotes(settings.anchorNotes, settings.anchorNote);
  renderAnchorNotes();
  renderControls();
  bindEvents();
  refreshStatus();
}

function bindEvents() {
  globalToggle.addEventListener("change", async () => {
    settings.enabled = globalToggle.checked;
    await saveAndApply();
    refreshStatus();
  });

  siteToggle.addEventListener("change", async () => {
    if (!activeDomain) {
      return;
    }

    const disabled = new Set(settings.disabledDomains.map(normalizeDomain));
    if (siteToggle.checked) {
      disabled.delete(activeDomain);
    } else {
      disabled.add(activeDomain);
    }
    settings.disabledDomains = Array.from(disabled).filter(Boolean).sort();
    await saveAndApply();
    refreshStatus();
  });

  addAnchorMessageButton.addEventListener("click", () => {
    if (noteDrafts.length >= MAX_ANCHOR_NOTES) {
      return;
    }
    noteDrafts.push("");
    renderAnchorNotes(noteDrafts.length - 1);
    renderControls();
  });

  reportMissedAdButton.addEventListener("click", async () => {
    if (!activeTab || !activeTab.id) {
      setStatus("No active webpage found.");
      return;
    }
    setStatus("Click the missed ad on the page. The report stays local.");
    try {
      renderStatusResponse(
        await sendMessageToTab(activeTab.id, {
          type: "AR_START_MISSED_AD_REPORT"
        })
      );
    } catch (error) {
      setStatus(`Report flow failed: ${formatChromeError(error)}`);
    }
  });

  replaceNowButton.addEventListener("click", async () => {
    if (!activeTab || !activeTab.id) {
      setStatus("No active webpage found.");
      return;
    }
    setStatus("Scanning this page...");
    try {
      renderStatusResponse(
        await sendMessageToTab(activeTab.id, { type: "AR_REPLACE_NOW" })
      );
    } catch (error) {
      setStatus(`Rescan failed: ${formatChromeError(error)}`);
    }
  });

  inspectClutterButton.addEventListener("click", async () => {
    if (!activeTab || !activeTab.id) {
      setStatus("No active webpage found.");
      return;
    }
    try {
      renderStatusResponse(
        await sendMessageToTab(activeTab.id, {
          type: "AR_TOGGLE_INSPECTOR"
        })
      );
    } catch (error) {
      setStatus(`Inspector failed: ${formatChromeError(error)}`);
    }
  });

  openOptionsButton.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
}

function renderControls() {
  globalToggle.checked = settings.enabled;
  siteToggle.checked = activeDomain
    ? !settings.disabledDomains.map(normalizeDomain).includes(activeDomain)
    : false;
  siteToggle.disabled = !activeDomain;
  siteLabel.textContent = activeDomain || "Not a normal webpage";

  addAnchorMessageButton.disabled = noteDrafts.length >= MAX_ANCHOR_NOTES;
  anchorCount.textContent =
    `${settings.anchorNotes.length}/${MAX_ANCHOR_NOTES} local notes`;

  replaceNowButton.disabled = !activeDomain;
  reportMissedAdButton.disabled = !activeDomain;
  reportMissedAdButton.textContent = inspectorReportMode
    ? "Close report flow"
    : "Report missed ad";
  inspectClutterButton.disabled = !activeDomain;
  inspectClutterButton.textContent = inspectorActive
    ? "Stop inspector"
    : "Diagnostic inspector";
}

// Note inputs are rendered once and never rewritten while the user types;
// renderControls() only touches disabled state, so debounced saves cannot
// steal the caret or strip trailing spaces mid-word.
function renderAnchorNotes(focusIndex) {
  anchorNotesContainer.replaceChildren(
    ...noteDrafts.map((note, index) => createNoteInput(note, index))
  );
  if (Number.isInteger(focusIndex)) {
    const target = anchorNotesContainer.querySelector(
      `input[data-index="${focusIndex}"]`
    );
    if (target) {
      target.focus();
    }
  }
}

function createNoteInput(note, index) {
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 180;
  input.dataset.index = String(index);
  input.value = note;
  input.placeholder =
    index === 0
      ? "Leave empty to draw nothing."
      : "Add another redirecting thought.";
  if (index === 0) {
    input.id = "anchorNote";
  }
  input.addEventListener("input", () => {
    noteDrafts[index] = input.value;
    settings.anchorNotes = normalizeAnchorNotes(noteDrafts);
    settings.anchorNote = settings.anchorNotes[0] || "";
    scheduleSave();
  });
  return input;
}

function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    await saveAndApply();
    refreshStatus();
  }, 180);
}

async function saveAndApply() {
  settings = mergeSettings(settings);
  await saveSettings(settings);
  if (!activeTab || !activeTab.id) {
    return;
  }
  try {
    await sendMessageToTab(activeTab.id, { type: "AR_SETTINGS_CHANGED" });
  } catch (_error) {
    // A newly opened or protected tab may not have a content script yet.
  }
}

async function refreshStatus() {
  renderControls();
  if (!activeTab || !activeTab.id || !activeDomain) {
    setStatus("Open a normal webpage to use this extension.");
    return;
  }
  if (!settings.enabled) {
    setStatus("Extension is off. Refresh to restore the original page.");
    return;
  }
  if (!siteToggle.checked) {
    setStatus("This site is off. Refresh to restore the original page.");
    return;
  }

  try {
    renderStatusResponse(
      await sendMessageToTab(activeTab.id, { type: "AR_GET_STATUS" })
    );
  } catch (error) {
    setStatus(`Ready after page load. ${formatChromeError(error)}`);
  }
}

function renderStatusResponse(response) {
  inspectorActive = Boolean(response && response.inspectorActive);
  inspectorReportMode = Boolean(response && response.inspectorReportMode);
  renderControls();
  if (response && response.inspectorError) {
    setStatus(response.inspectorError);
    return;
  }
  if (!response || (response.pageAllowed === false && !inspectorActive)) {
    setStatus("Page is skipped for safety or site settings.");
    return;
  }

  const count = Number(response.inserted || 0);
  const noteCount = settings.anchorNotes.length;
  const noteLabel = noteCount
    ? `${noteCount} note${noteCount === 1 ? "" : "s"}`
    : "no notes, surfaces removed";
  const inspectorText = inspectorActive
    ? inspectorReportMode
      ? " Report flow is open."
      : ` Inspector: ${Number(response.inspectorCandidateCount || 0)} suspects.`
    : "";
  setStatus(
    `${count} detected surface${count === 1 ? "" : "s"} · ${noteLabel}.${inspectorText}`
  );
}

function setStatus(message) {
  statusText.textContent = message;
}

function applyTheme(preference) {
  document.documentElement.dataset.theme = ["system", "light", "dark"].includes(
    preference
  )
    ? preference
    : "system";
}

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (items) => {
      resolve(mergeSettings(items[STORAGE_KEY]));
    });
  });
}

function saveSettings(nextSettings) {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      { [STORAGE_KEY]: mergeSettings(nextSettings) },
      resolve
    );
  });
}

function mergeSettings(value) {
  const stored = value && typeof value === "object" ? value : {};
  const legacyNotes = Array.isArray(stored.customNotes)
    ? stored.customNotes.map((note) => String(note || "").trim()).filter(Boolean)
    : [];
  const anchorNotes = resolveAnchorNotes(stored, legacyNotes);
  return {
    enabled: stored.enabled !== false,
    anchorNote: anchorNotes[0] || "",
    anchorNotes,
    reducedMotion: stored.reducedMotion === "still" ? "still" : "system",
    themePreference: ["system", "light", "dark"].includes(stored.themePreference)
      ? stored.themePreference
      : "system",
    disabledDomains: Array.isArray(stored.disabledDomains)
      ? Array.from(new Set(stored.disabledDomains.map(normalizeDomain))).filter(Boolean)
      : []
  };
}

function normalizeAnchorNotes(...sources) {
  const notes = [];

  sources.forEach((source) => {
    const values = Array.isArray(source) ? source : [source];
    values.forEach((value) => {
      const note = String(value || "").trim();
      if (note && !notes.includes(note)) {
        notes.push(note);
      }
    });
  });

  return notes.slice(0, MAX_ANCHOR_NOTES);
}

// An empty list is an answer, not an absence: emptying the notes is how the user
// says "just block, draw nothing". So the default note is owed only to an install
// that has never written the key at all, and every later read is taken at its
// word — otherwise deleting your last note silently hands it back.
function resolveAnchorNotes(stored, legacyNotes) {
  const written =
    Array.isArray(stored.anchorNotes) ||
    typeof stored.anchorNote === "string" ||
    legacyNotes.length > 0;
  const notes = normalizeAnchorNotes(
    stored.anchorNotes,
    stored.anchorNote,
    legacyNotes
  );
  return written ? notes : DEFAULT_SETTINGS.anchorNotes.slice();
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeNormalTab = tabs.find(isNormalWebTab);
      if (activeNormalTab) {
        resolve(activeNormalTab);
        return;
      }
      // Only when popup.html itself is open as a tab (dev/tests) does
      // tabs.getCurrent return a tab; the real toolbar popup gets undefined
      // and must never retarget a tab the user cannot see.
      chrome.tabs.getCurrent((ownTab) => {
        if (!ownTab) {
          resolve(null);
          return;
        }
        chrome.tabs.query({ currentWindow: true }, (windowTabs) => {
          resolve(
            windowTabs
              .filter(isNormalWebTab)
              .sort(
                (a, b) =>
                  Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0)
              )[0] || null
          );
        });
      });
    });
  });
}

function isNormalWebTab(tab) {
  try {
    const url = new URL(tab && tab.url);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_error) {
    return false;
  }
}

function getDomainFromTab(tab) {
  try {
    const url = new URL(tab && tab.url);
    return ["http:", "https:"].includes(url.protocol)
      ? normalizeDomain(url.hostname)
      : "";
  } catch (_error) {
    return "";
  }
}

function normalizeDomain(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
}

async function sendMessageToTab(tabId, message) {
  try {
    return await sendMessage(tabId, message);
  } catch (error) {
    if (!canInjectIntoActiveTab(error)) {
      throw error;
    }
    await injectContentScripts(tabId);
    return sendMessage(tabId, message);
  }
}

function sendMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(response);
    });
  });
}

function canInjectIntoActiveTab(error) {
  if (!activeDomain || !chrome.scripting) {
    return false;
  }
  const message = String((error && error.message) || error || "");
  return (
    message.includes("Receiving end does not exist") ||
    message.includes("Could not establish connection")
  );
}

function formatChromeError(error) {
  const message = String((error && error.message) || error || "").trim();
  if (!message) {
    return "unknown Chrome extension error.";
  }
  if (message.includes("Cannot access contents of url")) {
    return "Chrome will not allow access to this page.";
  }
  if (message.includes("Receiving end does not exist")) {
    return "content script was not available on this page.";
  }
  return message;
}

async function injectContentScripts(tabId) {
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: CONTENT_STYLE_FILES
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: CONTENT_SCRIPT_FILES
  });
}
