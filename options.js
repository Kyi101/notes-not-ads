const STORAGE_KEY = "attentionRedirectorSettings";
const DEFAULT_ANCHOR_NOTE = "Finish what deserves your attention.";
const MAX_ANCHOR_NOTES = 5;

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

const THEME_PREFERENCES = ["system", "light", "dark"];

function presenceRadioValue(value) {
  const n = Number(value);
  if (n <= 0) return 0;
  if (n >= 10) return 10;
  return 5;
}

const form = document.getElementById("optionsForm");
const enabledInput = document.getElementById("enabled");
const anchorField = document.getElementById("anchorField");
const anchorMessagesContainer = document.getElementById("anchorMessages");
const addAnchorMessageButton = document.getElementById("addAnchorMessage");
const anchorCount = document.getElementById("anchorCount");
const reducedMotionInput = document.getElementById("reducedMotion");
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

  form.addEventListener("change", () => {
    renderConditionalControls();
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
    renderConditionalControls();
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
  const modeInput = form.querySelector(
    `input[name="mode"][value="${settings.mode}"]`
  );
  if (modeInput) {
    modeInput.checked = true;
  }
  renderAnchorMessages(settings.anchorNotes);
  const presenceInput = form.querySelector(
    `input[name="visualPresence"][value="${presenceRadioValue(settings.visualPresence)}"]`
  );
  if (presenceInput) {
    presenceInput.checked = true;
  }
  reducedMotionInput.value = settings.reducedMotion;
  themePreferenceInput.value = settings.themePreference;
  applyTheme(settings.themePreference);
  disabledDomainsInput.value = settings.disabledDomains.join("\n");
  renderConditionalControls();
}

function applyTheme(preference) {
  document.documentElement.dataset.theme = THEME_PREFERENCES.includes(preference)
    ? preference
    : "system";
}

function renderConditionalControls() {
  const mode = form.querySelector("input[name='mode']:checked")?.value;
  const anchorActive = mode === "anchor";
  anchorMessagesContainer
    .querySelectorAll(".anchor-message-input")
    .forEach((input) => {
      input.disabled = !anchorActive;
    });
  updateAnchorMessageControls(anchorActive);
  anchorField.dataset.active = String(anchorActive);
}

function renderAnchorMessages(notes, options = {}) {
  const values = prepareAnchorMessageRows(notes);
  anchorMessagesContainer.replaceChildren(
    ...values.map((note, index) => createAnchorMessageRow(note, index))
  );
  updateAnchorMessageControls(
    form.querySelector("input[name='mode']:checked")?.value === "anchor"
  );

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

  return values.length ? values : [DEFAULT_ANCHOR_NOTE];
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
    index === 0 ? DEFAULT_ANCHOR_NOTE : "Add another redirecting thought.";
  input.addEventListener("input", () => {
    updateAnchorMessageControls(
      form.querySelector("input[name='mode']:checked")?.value === "anchor"
    );
  });

  const removeButton = document.createElement("button");
  removeButton.className = "secondary-button anchor-remove-button";
  removeButton.type = "button";
  removeButton.textContent = "Remove";
  removeButton.addEventListener("click", () => {
    const nextValues = readAnchorMessageInputs({ includeEmpty: true });
    nextValues.splice(index, 1);
    renderAnchorMessages(nextValues.length ? nextValues : [DEFAULT_ANCHOR_NOTE], {
      focusIndex: Math.max(0, index - 1)
    });
    renderConditionalControls();
  });

  row.append(input, removeButton);
  return row;
}

function updateAnchorMessageControls(anchorActive) {
  const rows = anchorMessagesContainer.querySelectorAll(".anchor-message-row");
  const count = rows.length || 1;
  anchorCount.textContent = `${count}/${MAX_ANCHOR_NOTES} local`;
  addAnchorMessageButton.disabled = !anchorActive || count >= MAX_ANCHOR_NOTES;
  anchorMessagesContainer
    .querySelectorAll(".anchor-remove-button")
    .forEach((button) => {
      button.disabled = !anchorActive || count <= 1;
    });
}

function readSettingsFromForm() {
  const anchorNotes = normalizeAnchorNotes(readAnchorMessageInputs());
  return mergeSettings({
    enabled: enabledInput.checked,
    mode:
      form.querySelector("input[name='mode']:checked")?.value ||
      DEFAULT_SETTINGS.mode,
    anchorNote: anchorNotes[0],
    anchorNotes,
    visualPresence: Number(
      form.querySelector("input[name='visualPresence']:checked")?.value ??
        DEFAULT_SETTINGS.visualPresence
    ),
    reducedMotion: reducedMotionInput.value,
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
