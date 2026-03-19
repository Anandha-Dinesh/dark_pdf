import { DEFAULT_SETTINGS, STORAGE_KEY } from "./config.js";

export async function loadSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY] ?? {};

  return {
    strength:
      typeof stored.strength === "number"
        ? stored.strength
        : DEFAULT_SETTINGS.strength,
  };
}

export async function saveSettings(nextSettings) {
  await chrome.storage.local.set({ [STORAGE_KEY]: nextSettings });
}
