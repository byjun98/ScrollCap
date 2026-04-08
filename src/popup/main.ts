type PopupResponse = {
  ok?: boolean;
  version?: string;
  captureId?: string | null;
  error?: string;
  cancelled?: boolean;
};

type PopupElements = {
  captureVisibleButton: HTMLButtonElement | null;
  fullPageButton: HTMLButtonElement | null;
  selectionButton: HTMLButtonElement | null;
  openLatestButton: HTMLButtonElement | null;
  openSettingsButton: HTMLButtonElement | null;
};

const elements: PopupElements = {
  captureVisibleButton: document.getElementById("captureVisibleButton") as HTMLButtonElement | null,
  fullPageButton: document.getElementById("fullPageButton") as HTMLButtonElement | null,
  selectionButton: document.getElementById("selectionButton") as HTMLButtonElement | null,
  openLatestButton: document.getElementById("openLatestButton") as HTMLButtonElement | null,
  openSettingsButton: document.getElementById("openSettingsButton") as HTMLButtonElement | null,
};

const state = {
  latestCaptureId: null as string | null,
};

document.addEventListener("DOMContentLoaded", () => {
  void initializePopup();
  elements.captureVisibleButton?.addEventListener("click", () => {
    void startVisibleCapture();
  });
  elements.fullPageButton?.addEventListener("click", () => {
    void startFullPageCapture();
  });
  elements.selectionButton?.addEventListener("click", () => {
    void startSelectionCapture();
  });
  elements.openLatestButton?.addEventListener("click", () => {
    void openLatestCaptureInEditor();
  });
  elements.openSettingsButton?.addEventListener("click", () => {
    void openSettingsPage();
  });
});

async function initializePopup() {
  await refreshLatestCaptureState();
}

async function refreshLatestCaptureState() {
  try {
    const captureResponse = (await chrome.runtime.sendMessage({ type: "capture/getLastCaptureId" })) as PopupResponse;
    state.latestCaptureId = captureResponse?.ok && captureResponse.captureId ? String(captureResponse.captureId) : null;
  } catch {
    state.latestCaptureId = null;
  }

  syncLatestCaptureButton();
}

function syncLatestCaptureButton() {
  if (!elements.openLatestButton) {
    return;
  }

  if (state.latestCaptureId) {
    elements.openLatestButton.disabled = false;
    return;
  }

  elements.openLatestButton.disabled = true;
}

async function startVisibleCapture() {
  setCaptureButtonDisabled("captureVisibleButton", true);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("현재 활성 탭을 찾지 못했습니다.");
    }

    const result = (await chrome.runtime.sendMessage({
      type: "capture/startVisible",
      tabId: tab.id,
    })) as PopupResponse;

    if (!result?.ok) {
      throw new Error(result?.error || "현재 화면 캡처를 시작하지 못했습니다.");
    }

    state.latestCaptureId = result.captureId ?? null;
    syncLatestCaptureButton();
  } catch (error) {
    console.error(error);
  } finally {
    setCaptureButtonDisabled("captureVisibleButton", false);
  }
}

async function startFullPageCapture() {
  setCaptureButtonDisabled("fullPageButton", true);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("현재 활성 탭을 찾지 못했습니다.");
    }

    const result = (await chrome.runtime.sendMessage({
      type: "capture/startFullPage",
      tabId: tab.id,
    })) as PopupResponse;

    if (!result?.ok) {
      throw new Error(result?.error || "전체 페이지 캡처를 완료하지 못했습니다.");
    }

    state.latestCaptureId = result.captureId ?? null;
    syncLatestCaptureButton();
  } catch (error) {
    console.error(error);
  } finally {
    setCaptureButtonDisabled("fullPageButton", false);
  }
}

async function startSelectionCapture() {
  setCaptureButtonDisabled("selectionButton", true);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("현재 활성 탭을 찾지 못했습니다.");
    }

    chrome.runtime
      .sendMessage({
        type: "capture/startSelection",
        tabId: tab.id,
      })
      .catch(() => null);

    window.close();
  } catch (error) {
    console.error(error);
    setCaptureButtonDisabled("selectionButton", false);
  }
}

async function openLatestCaptureInEditor() {
  if (!state.latestCaptureId) {
    return;
  }

  const url = chrome.runtime.getURL(`editor.html?captureId=${encodeURIComponent(state.latestCaptureId)}`);
  await chrome.tabs.create({ url });
  window.close();
}

async function openSettingsPage() {
  if (typeof chrome.runtime.openOptionsPage === "function") {
    await chrome.runtime.openOptionsPage();
  } else {
    await chrome.tabs.create({ url: chrome.runtime.getURL("settings.html") });
  }

  window.close();
}

function setCaptureButtonDisabled(
  buttonName: keyof Pick<PopupElements, "captureVisibleButton" | "fullPageButton" | "selectionButton">,
  disabled: boolean
) {
  const button = elements[buttonName];
  if (button) {
    button.disabled = disabled;
  }
}

export {};
