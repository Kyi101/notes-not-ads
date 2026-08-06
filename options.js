const STORAGE_KEY = "attentionRedirectorSettings";
const DEFAULT_ANCHOR_NOTE = "Finish what deserves your attention.";
const MAX_ANCHOR_NOTES = 5;

const DEFAULT_SETTINGS = {
  enabled: true,
  anchorNote: DEFAULT_ANCHOR_NOTE,
  anchorNotes: [DEFAULT_ANCHOR_NOTE],
  themePreference: "system",
  disabledDomains: []
};

const THEME_PREFERENCES = ["system", "light", "dark"];

const form = document.getElementById("optionsForm");
const enabledInput = document.getElementById("enabled");
const anchorMessagesContainer = document.getElementById("anchorMessages");
const addAnchorMessageButton = document.getElementById("addAnchorMessage");
const anchorCount = document.getElementById("anchorCount");
const themePreferenceInput = document.getElementById("themePreference");
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
    const nextSettings = readSettingsFromForm();
    await saveSettings(nextSettings);
    renderSettings(nextSettings);
    showStatus("Saved.");
  });

  themePreferenceInput.addEventListener("change", () => {
    applyTheme(themePreferenceInput.value);
  });

  addAnchorMessageButton.addEventListener("click", () => {
    const messages = readAnchorMessageInputs({ includeEmpty: true });
    if (messages.length >= MAX_ANCHOR_NOTES) {
      return;
    }
    renderAnchorMessages([...messages, ""], { focusIndex: messages.length });
  });

  resetButton.addEventListener("click", async () => {
    await saveSettings(DEFAULT_SETTINGS);
    renderSettings(DEFAULT_SETTINGS);
    showStatus("Reset.");
  });
}

function renderSettings(value) {
  const settings = mergeSettings(value);
  enabledInput.checked = settings.enabled;
  renderAnchorMessages(settings.anchorNotes);
  themePreferenceInput.value = settings.themePreference;
  applyTheme(settings.themePreference);
  disabledDomainsInput.value = settings.disabledDomains.join("\n");
}

function applyTheme(preference) {
  document.documentElement.dataset.theme = THEME_PREFERENCES.includes(preference)
    ? preference
    : "system";
}

function renderAnchorMessages(notes, options = {}) {
  const values = prepareAnchorMessageRows(notes);
  anchorMessagesContainer.replaceChildren(
    ...values.map((note, index) => createAnchorMessageRow(note, index))
  );
  updateAnchorMessageControls();

  if (Number.isInteger(options.focusIndex)) {
    const target = anchorMessagesContainer.querySelector(
      `.anchor-message-input[data-index="${options.focusIndex}"]`
    );
    if (target) {
      target.focus();
    }
  }
}

function prepareAnchorMessageRows(notes) {
  const values = Array.isArray(notes)
    ? notes.map((note) => String(note || "").trim()).slice(0, MAX_ANCHOR_NOTES)
    : normalizeAnchorNotes(notes);

  // One row always shows, even with no notes, so there is somewhere to type. An
  // empty row is not a note — it is how the field says the list is empty.
  return values.length ? values : [""];
}

function createAnchorMessageRow(note, index) {
  const row = document.createElement("div");
  row.className = "anchor-message-row";

  const input = document.createElement("input");
  input.className = "anchor-message-input";
  input.type = "text";
  input.maxLength = 160;
  input.dataset.index = String(index);
  input.value = note;
  input.placeholder =
    index === 0
      ? "Leave empty to draw nothing."
      : "Add another redirecting thought.";
  input.addEventListener("input", () => {
    updateAnchorMessageControls();
  });

  const removeButton = document.createElement("button");
  removeButton.className = "secondary-button anchor-remove-button";
  removeButton.type = "button";
  removeButton.textContent = "Remove";
  removeButton.addEventListener("click", () => {
    const nextValues = readAnchorMessageInputs({ includeEmpty: true });
    nextValues.splice(index, 1);
    renderAnchorMessages(nextValues.length ? nextValues : [""], {
      focusIndex: Math.max(0, index - 1)
    });
  });

  row.append(input, removeButton);
  return row;
}

function updateAnchorMessageControls() {
  const rows = anchorMessagesContainer.querySelectorAll(".anchor-message-row");
  anchorCount.textContent =
    `${readAnchorMessageInputs().length}/${MAX_ANCHOR_NOTES} local`;
  addAnchorMessageButton.disabled = rows.length >= MAX_ANCHOR_NOTES;
  anchorMessagesContainer
    .querySelectorAll(".anchor-remove-button")
    .forEach((button) => {
      button.disabled = rows.length <= 1;
    });
}

function readSettingsFromForm() {
  const anchorNotes = normalizeAnchorNotes(readAnchorMessageInputs());
  return mergeSettings({
    enabled: enabledInput.checked,
    anchorNote: anchorNotes[0] || "",
    anchorNotes,
    themePreference: themePreferenceInput.value,
    disabledDomains: splitLines(disabledDomainsInput.value).map(normalizeDomain)
  });
}

function readAnchorMessageInputs(options = {}) {
  const values = Array.from(
    anchorMessagesContainer.querySelectorAll(".anchor-message-input")
  )
    .map((input) => input.value.trim())
    .slice(0, MAX_ANCHOR_NOTES);

  if (options.includeEmpty) {
    return values.length ? values : [""];
  }

  return values.filter(Boolean);
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
  const anchorNotes = resolveAnchorNotes(stored, legacyNotes);

  return {
    enabled: stored.enabled !== false,
    anchorNote: anchorNotes[0] || "",
    anchorNotes,
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
