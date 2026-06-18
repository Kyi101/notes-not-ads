const STORAGE_KEY = "attentionRedirectorSettings";

const DEFAULT_SETTINGS = {
  enabled: true,
  mode: "quiet",
  anchorNote: "Finish what deserves your attention.",
  visualPresence: 10,
  reducedMotion: "system",
  disabledDomains: []
};

const form = document.getElementById("optionsForm");
const enabledInput = document.getElementById("enabled");
const anchorField = document.getElementById("anchorField");
const anchorNoteInput = document.getElementById("anchorNote");
const visualPresenceInput = document.getElementById("visualPresence");
const presenceValue = document.getElementById("presenceValue");
const presenceNumber = document.getElementById("presenceNumber");
const presenceDescription = document.getElementById("presenceDescription");
const reducedMotionInput = document.getElementById("reducedMotion");
const disabledDomainsInput = document.getElementById("disabledDomains");
const resetButton = document.getElementById("resetButton");
const saveStatus = document.getElementById("saveStatus");

document.addEventListener("DOMContentLoaded", init);

async function init() {
  renderSettings(await loadSettings());
  bindEvents();
}

function bindEvents() {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveSettings(readSettingsFromForm());
    showStatus("Saved.");
  });

  form.addEventListener("change", () => {
    renderConditionalControls();
  });

  visualPresenceInput.addEventListener("input", renderPresence);

  resetButton.addEventListener("click", async () => {
    await saveSettings(DEFAULT_SETTINGS);
    renderSettings(DEFAULT_SETTINGS);
    showStatus("Reset.");
  });
}

function renderSettings(value) {
  const settings = mergeSettings(value);
  enabledInput.checked = settings.enabled;
  const modeInput = form.querySelector(
    `input[name="mode"][value="${settings.mode}"]`
  );
  if (modeInput) {
    modeInput.checked = true;
  }
  anchorNoteInput.value = settings.anchorNote;
  visualPresenceInput.value = String(settings.visualPresence);
  reducedMotionInput.value = settings.reducedMotion;
  disabledDomainsInput.value = settings.disabledDomains.join("\n");
  renderConditionalControls();
  renderPresence();
}

function renderConditionalControls() {
  const mode = form.querySelector("input[name='mode']:checked")?.value;
  const anchorActive = mode === "anchor";
  anchorNoteInput.disabled = !anchorActive;
  anchorField.dataset.active = String(anchorActive);
}

function renderPresence() {
  const value = Number(visualPresenceInput.value);
  presenceNumber.textContent = String(value);
  visualPresenceInput.style.setProperty(
    "--range-progress",
    `${value * 10}%`
  );

  if (value === 0) {
    presenceValue.textContent = "Clean";
    presenceDescription.textContent =
      "All detected surfaces are hidden and collapsed.";
    return;
  }

  if (value === 10) {
    presenceValue.textContent = "Full Ambient";
    presenceDescription.textContent =
      "All detected surfaces become Tide.";
    return;
  }

  presenceValue.textContent = `${value} / 10`;
  presenceDescription.textContent =
    `${value * 10}% of detected surfaces become Tide; the rest are hidden.`;
}

function readSettingsFromForm() {
  return mergeSettings({
    enabled: enabledInput.checked,
    mode:
      form.querySelector("input[name='mode']:checked")?.value ||
      DEFAULT_SETTINGS.mode,
    anchorNote: anchorNoteInput.value,
    visualPresence: Number(visualPresenceInput.value),
    reducedMotion: reducedMotionInput.value,
    disabledDomains: splitLines(disabledDomainsInput.value).map(normalizeDomain)
  });
}

function splitLines(value) {
  return String(value || "")
    .split(/\n|,/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeDomain(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();

  if (!raw) {
    return "";
  }

  try {
    return stripWww(new URL(raw.includes("://") ? raw : `https://${raw}`).hostname);
  } catch (_error) {
    return stripWww(raw.split("/")[0]);
  }
}

function stripWww(hostname) {
  return hostname.replace(/^www\./, "");
}

function showStatus(message) {
  saveStatus.textContent = message;
  window.clearTimeout(showStatus.timer);
  showStatus.timer = window.setTimeout(() => {
    saveStatus.textContent = "";
  }, 1800);
}

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (items) => {
      resolve(mergeSettings(items[STORAGE_KEY]));
    });
  });
}

function saveSettings(settings) {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      {
        [STORAGE_KEY]: mergeSettings(settings)
      },
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
