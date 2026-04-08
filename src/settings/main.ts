import {
  DEFAULT_USER_SETTINGS,
  loadUserSettings,
  resetUserSettings,
  saveUserSettings,
  type UserSettings,
} from "../shared/user-settings";

type SettingsElements = {
  form: HTMLFormElement | null;
  exportSaveAs: HTMLInputElement | null;
  includeCropSizeInFilename: HTMLInputElement | null;
  suppressFixedElementsOnCapture: HTMLInputElement | null;
  filenameTemplate: HTMLInputElement | null;
  autoSaveSubfolder: HTMLInputElement | null;
  splitLargeExports: HTMLInputElement | null;
  settingsStatus: HTMLElement | null;
  resetButton: HTMLButtonElement | null;
  shortcutList: HTMLElement | null;
  openShortcutsButton: HTMLButtonElement | null;
};

const elements: SettingsElements = {
  form: document.getElementById("settingsForm") as HTMLFormElement | null,
  exportSaveAs: document.getElementById("exportSaveAs") as HTMLInputElement | null,
  includeCropSizeInFilename: document.getElementById("includeCropSizeInFilename") as HTMLInputElement | null,
  suppressFixedElementsOnCapture: document.getElementById("suppressFixedElementsOnCapture") as HTMLInputElement | null,
  filenameTemplate: document.getElementById("filenameTemplate") as HTMLInputElement | null,
  autoSaveSubfolder: document.getElementById("autoSaveSubfolder") as HTMLInputElement | null,
  splitLargeExports: document.getElementById("splitLargeExports") as HTMLInputElement | null,
  settingsStatus: document.getElementById("settingsStatus"),
  resetButton: document.getElementById("resetButton") as HTMLButtonElement | null,
  shortcutList: document.getElementById("shortcutList"),
  openShortcutsButton: document.getElementById("openShortcutsButton") as HTMLButtonElement | null,
};

document.addEventListener("DOMContentLoaded", () => {
  void initializeSettingsPage();
  elements.form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void handleSave();
  });
  elements.resetButton?.addEventListener("click", () => {
    void handleReset();
  });
  elements.openShortcutsButton?.addEventListener("click", () => {
    void openChromeShortcutsPage();
  });
});

async function initializeSettingsPage() {
  setStatus("저장된 설정을 불러오는 중입니다.");
  renderShortcutList([]);

  try {
    const settings = await loadUserSettings();
    applySettings(settings);
    setStatus("현재 설정을 불러왔습니다.");
  } catch {
    applySettings(DEFAULT_USER_SETTINGS);
    setStatus("설정을 불러오지 못해 기본값으로 표시했습니다.", true);
  }

  await refreshShortcutList();
}

async function handleSave() {
  const nextSettings: UserSettings = {
    exportSaveAs: Boolean(elements.exportSaveAs?.checked),
    includeCropSizeInFilename: Boolean(elements.includeCropSizeInFilename?.checked),
    suppressFixedElementsOnCapture: Boolean(elements.suppressFixedElementsOnCapture?.checked),
    filenameTemplate: String(elements.filenameTemplate?.value ?? "").trim() || DEFAULT_USER_SETTINGS.filenameTemplate,
    autoSaveSubfolder: String(elements.autoSaveSubfolder?.value ?? "").trim(),
    splitLargeExports: Boolean(elements.splitLargeExports?.checked),
  };

  setStatus("설정을 저장하는 중입니다.");

  try {
    const saved = await saveUserSettings(nextSettings);
    applySettings(saved);
    setStatus("설정을 저장했습니다.");
  } catch {
    setStatus("설정을 저장하지 못했습니다.", true);
  }
}

async function handleReset() {
  setStatus("기본 설정으로 되돌리는 중입니다.");

  try {
    const reset = await resetUserSettings();
    applySettings(reset);
    setStatus("기본 설정으로 되돌렸습니다.");
  } catch {
    setStatus("기본값으로 되돌리지 못했습니다.", true);
  }
}

function applySettings(settings: UserSettings) {
  if (elements.exportSaveAs) {
    elements.exportSaveAs.checked = settings.exportSaveAs;
  }

  if (elements.includeCropSizeInFilename) {
    elements.includeCropSizeInFilename.checked = settings.includeCropSizeInFilename;
  }

  if (elements.suppressFixedElementsOnCapture) {
    elements.suppressFixedElementsOnCapture.checked = settings.suppressFixedElementsOnCapture;
  }

  if (elements.filenameTemplate) {
    elements.filenameTemplate.value = settings.filenameTemplate;
  }

  if (elements.autoSaveSubfolder) {
    elements.autoSaveSubfolder.value = settings.autoSaveSubfolder;
  }

  if (elements.splitLargeExports) {
    elements.splitLargeExports.checked = settings.splitLargeExports;
  }
}

function setStatus(message: string, isError = false) {
  if (!elements.settingsStatus) {
    return;
  }

  elements.settingsStatus.textContent = message;
  elements.settingsStatus.style.color = isError ? "#d70015" : "rgba(29, 29, 31, 0.8)";
}

async function refreshShortcutList() {
  if (!chrome?.commands?.getAll) {
    renderShortcutList([]);
    return;
  }

  try {
    const commands = await chrome.commands.getAll();
    renderShortcutList(commands);
  } catch {
    renderShortcutList([]);
  }
}

function renderShortcutList(commands: chrome.commands.Command[]) {
  if (!elements.shortcutList) {
    return;
  }

  const shortcutMeta = [
    {
      name: "capture-visible",
      label: "현재 화면 캡처",
      description: "현재 보이는 영역만 빠르게 저장합니다.",
      fallback: "Ctrl+Shift+7",
    },
    {
      name: "capture-full-page",
      label: "전체 페이지 캡처",
      description: "긴 페이지를 자동으로 이어 붙여 저장합니다.",
      fallback: "Ctrl+Shift+8",
    },
    {
      name: "capture-selection",
      label: "선택 영역 캡처",
      description: "드래그로 고른 범위만 선택해 캡처합니다.",
      fallback: "Ctrl+Shift+9",
    },
    {
      name: "_execute_action",
      label: "팝업 열기",
      description: "ScrollCap 팝업을 바로 엽니다.",
      fallback: "Ctrl+Shift+0",
    },
  ];

  const html = shortcutMeta
    .map((item) => {
      const command = commands.find((entry) => entry.name === item.name);
      const shortcut = command?.shortcut?.trim() || item.fallback;
      return `
        <div class="shortcut-item">
          <div class="shortcut-copy">
            <span class="shortcut-label">${escapeHtml(item.label)}</span>
            <span class="shortcut-description">${escapeHtml(item.description)}</span>
          </div>
          <span class="shortcut-key">${escapeHtml(shortcut)}</span>
        </div>
      `;
    })
    .join("");

  elements.shortcutList.innerHTML = html;
}

async function openChromeShortcutsPage() {
  try {
    await chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  } catch {
    setStatus("Chrome 단축키 설정 페이지를 열지 못했습니다. 주소창에 chrome://extensions/shortcuts 를 직접 입력해 주세요.", true);
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
