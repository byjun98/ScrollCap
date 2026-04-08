export const USER_SETTINGS_KEY = "scrollCap.userSettings";

export type UserSettings = {
  exportSaveAs: boolean;
  includeCropSizeInFilename: boolean;
  suppressFixedElementsOnCapture: boolean;
  filenameTemplate: string;
  autoSaveSubfolder: string;
  splitLargeExports: boolean;
};

export const DEFAULT_USER_SETTINGS: UserSettings = {
  exportSaveAs: true,
  includeCropSizeInFilename: true,
  suppressFixedElementsOnCapture: true,
  filenameTemplate: "{captureId}",
  autoSaveSubfolder: "",
  splitLargeExports: false,
};

export async function loadUserSettings(): Promise<UserSettings> {
  const stored = await readSettingsFromStorage();
  return {
    ...DEFAULT_USER_SETTINGS,
    ...normalizeSettings(stored),
  };
}

export async function saveUserSettings(nextSettings: Partial<UserSettings>) {
  const current = await loadUserSettings();
  const merged = {
    ...current,
    ...normalizeSettings(nextSettings),
  };

  await writeSettingsToStorage(merged);
  return merged;
}

export async function resetUserSettings() {
  await writeSettingsToStorage(DEFAULT_USER_SETTINGS);
  return { ...DEFAULT_USER_SETTINGS };
}

async function readSettingsFromStorage() {
  try {
    const result = await chrome.storage.sync.get(USER_SETTINGS_KEY);
    return result[USER_SETTINGS_KEY] ?? null;
  } catch {
    const result = await chrome.storage.local.get(USER_SETTINGS_KEY);
    return result[USER_SETTINGS_KEY] ?? null;
  }
}

async function writeSettingsToStorage(settings: UserSettings) {
  try {
    await chrome.storage.sync.set({
      [USER_SETTINGS_KEY]: settings,
    });
  } catch {
    await chrome.storage.local.set({
      [USER_SETTINGS_KEY]: settings,
    });
  }
}

function normalizeSettings(value: unknown): Partial<UserSettings> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const source = value as Record<string, unknown>;
  return {
    exportSaveAs: toBooleanOrDefault(source.exportSaveAs, DEFAULT_USER_SETTINGS.exportSaveAs),
    includeCropSizeInFilename: toBooleanOrDefault(source.includeCropSizeInFilename, DEFAULT_USER_SETTINGS.includeCropSizeInFilename),
    suppressFixedElementsOnCapture: toBooleanOrDefault(
      source.suppressFixedElementsOnCapture,
      DEFAULT_USER_SETTINGS.suppressFixedElementsOnCapture
    ),
    filenameTemplate: toStringOrDefault(source.filenameTemplate, DEFAULT_USER_SETTINGS.filenameTemplate),
    autoSaveSubfolder: toStringOrDefault(source.autoSaveSubfolder, DEFAULT_USER_SETTINGS.autoSaveSubfolder),
    splitLargeExports: toBooleanOrDefault(source.splitLargeExports, DEFAULT_USER_SETTINGS.splitLargeExports),
  };
}

function toBooleanOrDefault(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function toStringOrDefault(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed || fallback;
}
