const STORAGE_KEY = "attentionRedirectorSettings";
const CONTENT_SCRIPT_FILES = ["src/cosmetic-filters.js", "src/content.js"];
const CONTENT_STYLE_FILES = ["src/content.css"];
const DEFAULT_ANCHOR_NOTE = "Finish what deserves your attention.";
const MAX_ANCHOR_NOTES = 5;

const PRESENCE_MODES = [
  {
    id: "clean",
    value: 0,
    label: "Clean",
    description: "Detected surfaces are removed and the page reflows."
  },
  {
    id: "balanced",
    value: 5,
    label: "Balanced",
    description: "About half become Tide; the rest are removed."
  },
  {
    id: "full",
    value: 10,
    label: "Full Ambient",
    description: "Every detected surface becomes Tide."
  }
];

function presenceModeFromValue(value) {
  const n = Number(value);
  if (n <= 0) return PRESENCE_MODES[0];
  if (n >= 10) return PRESENCE_MODES[2];
  return PRESENCE_MODES[1];
}

function presenceModeById(id) {
  return PRESENCE_MODES.find((mode) => mode.id === id) || PRESENCE_MODES[2];
}

const DEFAULT_SETTINGS = {
  enabled: true,
  mode: "quiet",
  anchorNote: DEFAULT_ANCHOR_NOTE,
  anchorNotes: [DEFAULT_ANCHOR_NOTE],
  visualPresence: 10,
  reducedMotion: "system",
  themePreference: "system",
  disabledDomains: []
};

const globalToggle = document.getElementById("globalToggle");
const siteToggle = document.getElementById("siteToggle");
const siteLabel = document.getElementById("siteLabel");
const anchorField = document.getElementById("anchorField");
const anchorNotesContainer = document.getElementById("anchorNotes");
const addAnchorMessageButton = document.getElementById("addAnchorMessage");
const anchorCount = document.getElementById("anchorCount");
const presenceModeButtons = document.querySelectorAll("[data-presence]");
const presenceDescription = document.getElementById("presenceDescription");
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

  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", async () => {
      settings.mode = button.dataset.mode;
      renderControls();
      await saveAndApply();
      refreshStatus();
    });
  });

  addAnchorMessageButton.addEventListener("click", () => {
    if (noteDrafts.length >= MAX_ANCHOR_NOTES) {
      return;
    }
    noteDrafts.push("");
    renderAnchorNotes(noteDrafts.length - 1);
    renderControls();
  });

  presenceModeButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      settings.visualPresence = presenceModeById(button.dataset.presence).value;
      renderPresence();
      await saveAndApply();
      refreshStatus();
    });
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

  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.mode === settings.mode)
    );
  });

  const anchorActive = settings.mode === "anchor";
  anchorNotesContainer.querySelectorAll("input").forEach((input) => {
    input.disabled = !anchorActive;
  });
  addAnchorMessageButton.disabled =
    !anchorActive || noteDrafts.length >= MAX_ANCHOR_NOTES;
  anchorCount.textContent =
    `${noteDrafts.length}/${MAX_ANCHOR_NOTES} local messages`;
  anchorField.dataset.active = String(anchorActive);
  renderPresence();

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
  input.disabled = settings.mode !== "anchor";
  input.placeholder =
    index === 0 ? DEFAULT_ANCHOR_NOTE : "Add another redirecting thought.";
  if (index === 0) {
    input.id = "anchorNote";
  }
  input.addEventListener("input", () => {
    noteDrafts[index] = input.value;
    settings.anchorNotes = normalizeAnchorNotes(noteDrafts);
    settings.anchorNote = settings.anchorNotes[0];
    scheduleSave();
  });
  return input;
}

function renderPresence() {
  const active = presenceModeFromValue(settings.visualPresence);
  presenceModeButtons.forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.presence === active.id)
    );
  });
  presenceDescription.textContent = active.description;
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
  const modeLabel = settings.mode === "anchor" ? "Anchor" : "Quiet";
  const presenceLabel = presenceModeFromValue(settings.visualPresence).label;
  const inspectorText = inspectorActive
    ? inspectorReportMode
      ? " Report flow is open."
      : ` Inspector: ${Number(response.inspectorCandidateCount || 0)} suspects.`
    : "";
  setStatus(
    `${count} detected surface${count === 1 ? "" : "s"} · ${modeLabel} · ${presenceLabel}.${inspectorText}`
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
  const anchorNotes = normalizeAnchorNotes(
    stored.anchorNotes,
    stored.anchorNote,
    legacyNotes
  );
  const hasAnchorNotes =
    hasAnchorNoteInput(stored.anchorNotes) ||
    hasAnchorNoteInput(stored.anchorNote) ||
    legacyNotes.length > 0;
  const legacyPresence =
    stored.frequency === "max1" ? 3 : stored.frequency === "max3" ? 6 : 10;
  return {
    enabled: stored.enabled !== false,
    mode: ["quiet", "anchor"].includes(stored.mode)
      ? stored.mode
      : hasAnchorNotes
        ? "anchor"
        : DEFAULT_SETTINGS.mode,
    anchorNote: anchorNotes[0],
    anchorNotes,
    visualPresence: Number.isFinite(Number(stored.visualPresence))
      ? Math.min(10, Math.max(0, Math.round(Number(stored.visualPresence))))
      : legacyPresence,
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

  return notes.length ? notes.slice(0, MAX_ANCHOR_NOTES) : [DEFAULT_ANCHOR_NOTE];
}

function hasAnchorNoteInput(value) {
  if (Array.isArray(value)) {
    return value.some(hasAnchorNoteInput);
  }
  return typeof value === "string" && Boolean(value.trim());
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
