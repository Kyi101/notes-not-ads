const STORAGE_KEY = "attentionRedirectorSettings";
const THEME_PREFERENCES = ["system", "light", "dark"];

document.addEventListener("DOMContentLoaded", () => {
  applySavedTheme();

  const openOptions = document.getElementById("openOptions");
  openOptions.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
});

function applySavedTheme() {
  chrome.storage.local.get(STORAGE_KEY, (items) => {
    const stored = (items && items[STORAGE_KEY]) || {};
    const preference = THEME_PREFERENCES.includes(stored.themePreference)
      ? stored.themePreference
      : "system";
    document.documentElement.dataset.theme = preference;
  });
}
