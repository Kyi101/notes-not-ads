const STORAGE_KEY = "attentionRedirectorSettings";
const CONTENT_SCRIPT_FILES = ["src/cosmetic-filters.js", "src/content.js"];
const CONTENT_STYLE_FILES = ["src/content.css"];

const DEFAULT_SETTINGS = {
  enabled: true,
  mode: "quiet",
  anchorNote: "Finish what deserves your attention.",
  visualPresence: 10,
  reducedMotion: "system",
  disabledDomains: []
};

const globalToggle = document.getElementById("globalToggle");
const siteToggle = document.getElementById("siteToggle");
const siteLabel = document.getElementById("siteLabel");
const anchorField = document.getElementById("anchorField");
const anchorNoteInput = document.getElementById("anchorNote");
const visualPresenceInput = document.getElementById("visualPresence");
const presenceValue = document.getElementById("presenceValue");
const replaceNowButton = document.getElementById("replaceNow");
const inspectClutterButton = document.getElementById("inspectClutter");
const openOptionsButton = document.getElementById("openOptions");
const statusText = document.getElementById("statusText");

let activeTab = null;
let activeDomain = "";
let settings = { ...DEFAULT_SETTINGS };
let inspectorActive = false;
let saveTimer = 0;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  settings = await loadSettings();
  activeTab = await getActiveTab();
  activeDomain = getDomainFromTab(activeTab);
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

  anchorNoteInput.addEventListener("input", () => {
    settings.anchorNote =
      anchorNoteInput.value.trim() || DEFAULT_SETTINGS.anchorNote;
    scheduleSave();
  });

  visualPresenceInput.addEventListener("input", () => {
    settings.visualPresence = Number(visualPresenceInput.value);
    renderPresence();
    scheduleSave();
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

  anchorNoteInput.value = settings.anchorNote;
  anchorNoteInput.disabled = settings.mode !== "anchor";
  anchorField.dataset.active = String(settings.mode === "anchor");
  visualPresenceInput.value = String(settings.visualPresence);
  renderPresence();

  replaceNowButton.disabled = !activeDomain;
  inspectClutterButton.disabled = !activeDomain;
  inspectClutterButton.textContent = inspectorActive
    ? "Stop inspector"
    : "Inspect missed clutter";
}

function renderPresence() {
  const value = Number(settings.visualPresence);
  presenceValue.textContent =
    value === 0 ? "Clean" : value === 10 ? "Full Ambient" : `${value} / 10`;
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
  const presenceLabel =
    settings.visualPresence === 0
      ? "Clean"
      : settings.visualPresence === 10
        ? "Full Ambient"
        : `${settings.visualPresence}/10 presence`;
  const inspectorText = inspectorActive
    ? ` Inspector: ${Number(response.inspectorCandidateCount || 0)} suspects.`
    : "";
  setStatus(
    `${count} detected surface${count === 1 ? "" : "s"} · ${modeLabel} · ${presenceLabel}.${inspectorText}`
  );
}

function setStatus(message) {
  statusText.textContent = message;
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
  const legacyPresence =
    stored.frequency === "max1" ? 3 : stored.frequency === "max3" ? 6 : 10;
  return {
    enabled: stored.enabled !== false,
    mode: ["quiet", "anchor"].includes(stored.mode)
      ? stored.mode
      : legacyNotes.length
        ? "anchor"
        : DEFAULT_SETTINGS.mode,
    anchorNote:
      typeof stored.anchorNote === "string" && stored.anchorNote.trim()
        ? stored.anchorNote.trim()
        : legacyNotes[0] || DEFAULT_SETTINGS.anchorNote,
    visualPresence: Number.isFinite(Number(stored.visualPresence))
      ? Math.min(10, Math.max(0, Math.round(Number(stored.visualPresence))))
      : legacyPresence,
    reducedMotion: stored.reducedMotion === "still" ? "still" : "system",
    disabledDomains: Array.isArray(stored.disabledDomains)
      ? Array.from(new Set(stored.disabledDomains.map(normalizeDomain))).filter(Boolean)
      : []
  };
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeNormalTab = tabs.find(isNormalWebTab);
      if (activeNormalTab) {
        resolve(activeNormalTab);
        return;
      }
      chrome.tabs.query({}, (allTabs) => {
        resolve(
          allTabs
            .filter(isNormalWebTab)
            .sort(
              (a, b) =>
                Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0)
            )[0] || null
        );
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
