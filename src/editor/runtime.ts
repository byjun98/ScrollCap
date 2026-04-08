// @ts-nocheck
const CAPTURE_KEY_PREFIX = "scrollCapture.capture.";
const ASSET_KEY_PREFIX = "scrollCapture.asset.";
const assetStoreModulePromise = import("./storage").catch(() => null);
const userSettingsModulePromise = import("../shared/user-settings").catch(() => null);
const CROP_AUTOSCROLL_EDGE_PX = 72;
const CROP_AUTOSCROLL_MIN_STEP_PX = 8;
const CROP_AUTOSCROLL_MAX_STEP_PX = 28;
const LARGE_EXPORT_SPLIT_THRESHOLD_BYTES = 20 * 1024 * 1024;

const DEFAULT_EMPTY_COPY = {
  title: "캡처 결과가 여기에 표시됩니다",
  message: "페이지를 캡처하거나 불러오면 이어 붙인 결과를 미리 보고 저장 준비를 할 수 있습니다.",
};

const DEFAULT_LOADING_COPY = {
  message: "IndexedDB에서 캡처 기록과 이미지 자산을 찾고, 필요하면 로컬 저장소도 함께 확인합니다.",
};

const DEFAULT_SUMMARY = {
  captureSource: "캡처 대기 중",
  captureSourceUrl: "",
  fileSize: "알 수 없음",
  crop: "전체 이미지",
  status: "캡처 결과를 기다리는 중입니다.",
};

const state = {
  view: "loading",
  captureId: null,
  captureRecord: null,
  assetDataUrl: null,
  imageSize: null,
  captureSource: DEFAULT_SUMMARY.captureSource,
  captureSourceUrl: DEFAULT_SUMMARY.captureSourceUrl,
  fileSize: DEFAULT_SUMMARY.fileSize,
  cropSummary: DEFAULT_SUMMARY.crop,
  status: DEFAULT_SUMMARY.status,
  loadingMessage: DEFAULT_LOADING_COPY.message,
  loadingProgressVisible: true,
  loadingProgressLabel: "캡처 준비 중",
  loadingProgressCurrent: 0,
  loadingProgressMax: 1,
  errorTitle: "캡처를 불러오지 못했습니다",
  errorMessage: "요청한 캡처를 찾지 못했거나 이미지 자산이 비어 있습니다.",
  emptyTitle: DEFAULT_EMPTY_COPY.title,
  emptyMessage: DEFAULT_EMPTY_COPY.message,
  caption: "",
  cropModeEnabled: false,
  cropRect: null,
  appliedCropRect: null,
  cropInteraction: null,
  cropAutoScrollFrameId: 0,
  cropHistoryPast: [],
  cropHistoryFuture: [],
};

const els = {
  sourceLink: document.getElementById("sourceLink"),
  fileSizeValue: document.getElementById("fileSizeValue"),
  cropValue: document.getElementById("cropValue"),
  statusText: document.getElementById("statusText"),
  loadingState: document.getElementById("loadingState"),
  loadingMessage: document.getElementById("loadingMessage"),
  loadingProgress: document.getElementById("loadingProgress"),
  loadingProgressLabel: document.getElementById("loadingProgressLabel"),
  loadingProgressText: document.getElementById("loadingProgressText"),
  loadingProgressBar: document.getElementById("loadingProgressBar"),
  errorState: document.getElementById("errorState"),
  errorTitle: document.getElementById("errorTitle"),
  errorMessage: document.getElementById("errorMessage"),
  emptyState: document.getElementById("emptyState"),
  emptyStateTitle: document.getElementById("emptyStateTitle"),
  emptyStateMessage: document.getElementById("emptyStateMessage"),
  previewStage: document.getElementById("previewStage"),
  captureStageShell: document.querySelector(".capture-stage-shell"),
  captureViewport: document.getElementById("captureViewport"),
  captureSurface: document.getElementById("captureSurface"),
  captureImage: document.getElementById("captureImage"),
  captureCaption: document.getElementById("captureCaption"),
  cropOverlay: document.getElementById("cropOverlay"),
  cropBox: document.getElementById("cropBox"),
  cropBoxLabel: document.getElementById("cropBoxLabel"),
  cropBoxDimensions: document.getElementById("cropBoxDimensions"),
  canvasPlaceholder: document.getElementById("canvasPlaceholder"),
  retryButton: document.getElementById("retryButton"),
  toolbarButtons: document.querySelectorAll("[data-action]"),
  undoCropButton: document.getElementById("undoCropButton"),
  redoCropButton: document.getElementById("redoCropButton"),
  cropToggleButton: document.getElementById("cropToggleButton"),
  cropDoneButton: document.getElementById("cropDoneButton"),
  exportPngButton: document.getElementById("exportPngButton"),
  exportJpegButton: document.getElementById("exportJpegButton"),
};

document.addEventListener("DOMContentLoaded", () => {
  void initializeEditor();

  els.retryButton?.addEventListener("click", () => {
    void initializeEditor();
  });

  els.captureImage?.addEventListener("load", () => {
    if (state.view === "preview") {
      renderCropOverlay();
    }
  });

  els.captureStageShell?.addEventListener("pointerdown", handleCropPointerDown);
  els.captureStageShell?.addEventListener("scroll", () => {
    if (state.view === "preview" && state.cropRect) {
      renderCropOverlay();
    }
  }, { passive: true });
  window.addEventListener("pointermove", handleCropPointerMove);
  window.addEventListener("pointerup", handleCropPointerEnd);
  window.addEventListener("pointercancel", handleCropPointerEnd);
  window.addEventListener("keydown", handleEditorKeydown);
  window.addEventListener("resize", () => {
    if (state.view === "preview") {
      renderPreviewCrop();
      renderCropOverlay();
    }
  });

  els.toolbarButtons.forEach((button) => {
    button.addEventListener("click", () => handleToolbarAction(button.dataset.action));
  });
});

function renderState() {
  const captureSourceUrl = typeof state.captureSourceUrl === "string" ? state.captureSourceUrl.trim() : "";
  const sourceText = captureSourceUrl || state.captureSource;
  els.sourceLink.textContent = sourceText;
  els.sourceLink.title = sourceText;
  if (captureSourceUrl) {
    els.sourceLink.setAttribute("href", captureSourceUrl);
    els.sourceLink.removeAttribute("aria-disabled");
    els.sourceLink.tabIndex = 0;
  } else {
    els.sourceLink.removeAttribute("href");
    els.sourceLink.setAttribute("aria-disabled", "true");
    els.sourceLink.tabIndex = -1;
  }
  els.fileSizeValue.textContent = state.fileSize;
  els.cropValue.textContent = state.cropSummary;
  els.statusText.textContent = state.status;
  els.loadingMessage.textContent = state.loadingMessage;
  els.errorTitle.textContent = state.errorTitle;
  els.errorMessage.textContent = state.errorMessage;
  els.emptyStateTitle.textContent = state.emptyTitle;
  els.emptyStateMessage.textContent = state.emptyMessage;
  els.captureCaption.textContent = state.caption;

  const progressVisible = state.view === "loading" && state.loadingProgressVisible;
  els.loadingState.hidden = state.view !== "loading";
  els.loadingProgress.hidden = !progressVisible;
  els.loadingProgressLabel.textContent = state.loadingProgressLabel;

  const progressMax = Math.max(1, state.loadingProgressMax);
  const progressCurrent = clampNumber(state.loadingProgressCurrent, 0, progressMax);
  const progressPercent = Math.round((progressCurrent / progressMax) * 100);
  els.loadingProgressText.textContent = `${progressPercent}%`;
  els.loadingProgressBar.style.width = `${progressPercent}%`;

  els.errorState.hidden = state.view !== "error";
  els.emptyState.hidden = state.view !== "empty";
  els.previewStage.hidden = state.view !== "preview";
  els.canvasPlaceholder.hidden = true;

  syncToolbarState();

  if (state.view === "preview") {
    const nextSrc = state.assetDataUrl ?? "";
    if (els.captureImage.getAttribute("src") !== nextSrc) {
      els.captureImage.src = nextSrc;
    }
    els.captureImage.alt = state.caption || "불러온 스크롤 캡처 미리보기";
    renderPreviewCrop();
    renderCropOverlay();
  } else {
    els.captureImage.removeAttribute("src");
    els.captureImage.alt = "불러온 스크롤 캡처 미리보기";
    resetPreviewCropStyles();
    hideCropOverlay();
  }
}

function syncToolbarState() {
  const isPreview = state.view === "preview";
  const hasCrop = Boolean(state.cropRect);
  const canUndoCrop = isPreview && state.cropHistoryPast.length > 0;
  const canRedoCrop = isPreview && state.cropHistoryFuture.length > 0;

  if (els.undoCropButton) {
    els.undoCropButton.disabled = !canUndoCrop;
  }

  if (els.redoCropButton) {
    els.redoCropButton.disabled = !canRedoCrop;
  }

  if (els.cropToggleButton) {
    els.cropToggleButton.disabled = !isPreview;
    els.cropToggleButton.setAttribute("aria-pressed", state.cropModeEnabled && isPreview ? "true" : "false");
  }

  if (els.cropDoneButton) {
    els.cropDoneButton.disabled = !isPreview || !state.cropModeEnabled;
  }

  if (els.exportPngButton) {
    els.exportPngButton.disabled = !isPreview;
  }

  if (els.exportJpegButton) {
    els.exportJpegButton.disabled = !isPreview;
  }

  if (els.captureStageShell) {
    els.captureStageShell.classList.toggle("is-cropping", isPreview && state.cropModeEnabled);
    els.captureStageShell.classList.toggle("is-crop-dragging", isPreview && Boolean(state.cropInteraction));
  }

  if (els.cropOverlay) {
    els.cropOverlay.hidden = !isPreview || !hasCrop || !state.cropModeEnabled;
  }
}

function hideCropOverlay() {
  if (els.cropOverlay) {
    els.cropOverlay.hidden = true;
  }
}

function getImageDisplayMetrics() {
  if (!els.captureImage || !state.imageSize) {
    return null;
  }

  const rect = els.captureImage.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return null;
  }

  const scaleX = rect.width / state.imageSize.width;
  const scaleY = rect.height / state.imageSize.height;
  return {
    rect,
    scaleX,
    scaleY,
  };
}

function renderCropOverlay() {
  syncToolbarState();

  if (!els.cropOverlay || !els.cropBox || !els.cropBoxDimensions || !state.cropRect || state.view !== "preview") {
    return;
  }

  const metrics = getImageDisplayMetrics();
  if (!metrics) {
    return;
  }

  const rect = normalizeCropRect(state.cropRect, state.imageSize);
  if (!rect) {
    return;
  }

  const left = rect.x * metrics.scaleX;
  const top = rect.y * metrics.scaleY;
  const width = rect.width * metrics.scaleX;
  const height = rect.height * metrics.scaleY;

  els.cropOverlay.hidden = false;
  els.cropBox.style.left = `${left}px`;
  els.cropBox.style.top = `${top}px`;
  els.cropBox.style.width = `${Math.max(1, width)}px`;
  els.cropBox.style.height = `${Math.max(1, height)}px`;
  els.cropBoxDimensions.textContent = `${rect.width} x ${rect.height}px`;
}

function renderPreviewCrop() {
  if (!els.captureStageShell || !els.captureViewport || !els.captureSurface || !state.imageSize) {
    return;
  }

  const activeCrop = !state.cropModeEnabled
    ? normalizeCropRect(state.appliedCropRect, state.imageSize)
    : null;

  if (!activeCrop) {
    resetPreviewCropStyles();
    return;
  }

  const shellWidth = Math.max(1, els.captureStageShell.clientWidth);
  const scale = shellWidth / activeCrop.width;
  const fullDisplayWidth = Math.max(1, Math.round(state.imageSize.width * scale));
  const fullDisplayHeight = Math.max(1, Math.round(state.imageSize.height * scale));
  const cropDisplayWidth = shellWidth;
  const cropDisplayHeight = Math.max(1, Math.round(activeCrop.height * scale));
  const offsetX = Math.round(activeCrop.x * scale);
  const offsetY = Math.round(activeCrop.y * scale);

  els.captureStageShell.classList.add("is-preview-cropped");
  els.captureStageShell.scrollTop = 0;
  els.captureStageShell.scrollLeft = 0;
  els.captureViewport.style.width = `${cropDisplayWidth}px`;
  els.captureViewport.style.height = `${cropDisplayHeight}px`;
  els.captureViewport.style.overflow = "hidden";
  els.captureSurface.style.width = `${fullDisplayWidth}px`;
  els.captureSurface.style.height = `${fullDisplayHeight}px`;
  els.captureSurface.style.transform = `translate(${-offsetX}px, ${-offsetY}px)`;
}

function resetPreviewCropStyles() {
  if (!els.captureStageShell || !els.captureViewport || !els.captureSurface) {
    return;
  }

  els.captureStageShell.classList.remove("is-preview-cropped");
  els.captureViewport.style.width = "";
  els.captureViewport.style.height = "";
  els.captureViewport.style.overflow = "";
  els.captureSurface.style.width = "";
  els.captureSurface.style.height = "";
  els.captureSurface.style.transform = "";
}

function syncCropSummary() {
  const draftRect = normalizeCropRect(state.cropRect, state.imageSize);
  const appliedRect = normalizeCropRect(state.appliedCropRect, state.imageSize);

  if (state.cropModeEnabled && draftRect) {
    state.cropSummary = `임시 영역 ${draftRect.width} x ${draftRect.height}px · ${draftRect.x}, ${draftRect.y}`;
    return;
  }

  if (appliedRect) {
    state.cropSummary = `적용됨 ${appliedRect.width} x ${appliedRect.height}px · ${appliedRect.x}, ${appliedRect.y}`;
    return;
  }

  state.cropSummary = DEFAULT_SUMMARY.crop;
}

function normalizeCropRect(cropRect, imageSize = state.imageSize) {
  if (!cropRect || !imageSize) {
    return null;
  }

  const width = Number(cropRect.width);
  const height = Number(cropRect.height);
  const x = Number(cropRect.x);
  const y = Number(cropRect.y);

  if (![width, height, x, y].every(Number.isFinite)) {
    return null;
  }

  const maxWidth = Math.max(1, Number(imageSize.width) || 0);
  const maxHeight = Math.max(1, Number(imageSize.height) || 0);
  const normalizedWidth = clampNumber(Math.round(width), 1, maxWidth);
  const normalizedHeight = clampNumber(Math.round(height), 1, maxHeight);
  const normalizedX = clampNumber(Math.round(x), 0, Math.max(0, maxWidth - normalizedWidth));
  const normalizedY = clampNumber(Math.round(y), 0, Math.max(0, maxHeight - normalizedHeight));

  return {
    x: normalizedX,
    y: normalizedY,
    width: normalizedWidth,
    height: normalizedHeight,
  };
}

function cloneCropRect(cropRect) {
  const normalized = normalizeCropRect(cropRect, state.imageSize);
  return normalized ? { ...normalized } : null;
}

function resetCropHistory() {
  state.cropHistoryPast = [];
  state.cropHistoryFuture = [];
}

function commitAppliedCrop(nextCropRect) {
  const nextApplied = cloneCropRect(nextCropRect);
  const currentApplied = cloneCropRect(state.appliedCropRect);

  if (areCropRectsEqual(currentApplied, nextApplied)) {
    state.appliedCropRect = nextApplied;
    state.cropRect = cloneCropRect(nextApplied);
    syncCropSummary();
    renderState();
    return;
  }

  state.cropHistoryPast.push(currentApplied);
  if (state.cropHistoryPast.length > 100) {
    state.cropHistoryPast.shift();
  }
  state.cropHistoryFuture = [];
  state.appliedCropRect = nextApplied;
  state.cropRect = cloneCropRect(nextApplied);
  syncCropSummary();
  renderState();
}

function restoreAppliedCropFromHistory(nextAppliedCropRect, directionLabel) {
  state.appliedCropRect = cloneCropRect(nextAppliedCropRect);
  state.cropRect = cloneCropRect(nextAppliedCropRect);
  state.cropModeEnabled = false;
  state.cropInteraction = null;
  stopCropAutoScroll();
  syncCropSummary();
  state.status = state.appliedCropRect
    ? `${directionLabel}: ${state.appliedCropRect.width} x ${state.appliedCropRect.height}px.`
    : `${directionLabel}: 전체 이미지로 복원했습니다.`;
  renderState();
}

function undoCropHistory() {
  if (!state.cropHistoryPast.length) {
    return;
  }

  const previous = state.cropHistoryPast.pop();
  state.cropHistoryFuture.push(cloneCropRect(state.appliedCropRect));
  restoreAppliedCropFromHistory(previous, "크롭 되돌리기");
}

function redoCropHistory() {
  if (!state.cropHistoryFuture.length) {
    return;
  }

  const next = state.cropHistoryFuture.pop();
  state.cropHistoryPast.push(cloneCropRect(state.appliedCropRect));
  restoreAppliedCropFromHistory(next, "크롭 다시하기");
}

function areCropRectsEqual(left, right) {
  if (!left && !right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

function setCropRect(nextCropRect) {
  state.cropRect = normalizeCropRect(nextCropRect);
  syncCropSummary();
  renderCropOverlay();
  renderState();
}

function setStatus(message) {
  state.status = message;
  renderState();
}

function handleEditorKeydown(event) {
  if (isTypingTarget(event.target)) {
    return;
  }

  const modifierPressed = event.ctrlKey || event.metaKey;
  if (!modifierPressed) {
    return;
  }

  const key = event.key.toLowerCase();
  if (key === "z" && !event.shiftKey) {
    event.preventDefault();
    undoCropHistory();
    return;
  }

  if (key === "y" || (key === "z" && event.shiftKey)) {
    event.preventDefault();
    redoCropHistory();
  }
}

function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function setView(view) {
  state.view = view;
  renderState();
}

function setSummary(nextState = {}) {
  if (typeof nextState.captureSource === "string") {
    state.captureSource = nextState.captureSource;
  }
  if (typeof nextState.captureSourceUrl === "string") {
    state.captureSourceUrl = nextState.captureSourceUrl;
  }
  if (typeof nextState.fileSize === "string") {
    state.fileSize = nextState.fileSize;
  }
  if (typeof nextState.status === "string") {
    state.status = nextState.status;
  }
  if (typeof nextState.empty === "boolean") {
    applyEmptyMode(Boolean(nextState.empty));
    return;
  }

  renderState();
}

function applyEmptyMode(isEmpty) {
  if (isEmpty) {
    stopCropAutoScroll();
    state.view = "empty";
    state.emptyTitle = "미리보기를 비웠습니다";
    state.emptyMessage = "불러온 캡처 자체는 저장소에 남아 있습니다. 에디터를 새로 열면 다시 확인할 수 있습니다.";
    state.cropModeEnabled = false;
    state.cropRect = null;
    state.appliedCropRect = null;
    state.cropInteraction = null;
    resetCropHistory();
    syncCropSummary();
  } else {
    state.view = state.captureRecord ? "preview" : "loading";
    state.emptyTitle = DEFAULT_EMPTY_COPY.title;
    state.emptyMessage = DEFAULT_EMPTY_COPY.message;
  }

  renderState();
}

function resetToLoading(message) {
  stopCropAutoScroll();
  state.view = "loading";
  state.captureRecord = null;
  state.assetDataUrl = null;
  state.imageSize = null;
  state.captureSource = DEFAULT_SUMMARY.captureSource;
  state.captureSourceUrl = DEFAULT_SUMMARY.captureSourceUrl;
  state.fileSize = DEFAULT_SUMMARY.fileSize;
  state.status = "캡처를 여는 중입니다";
  state.loadingMessage = message ?? DEFAULT_LOADING_COPY.message;
  state.loadingProgressVisible = true;
  state.loadingProgressLabel = "캡처 준비 중";
  state.loadingProgressCurrent = 0;
  state.loadingProgressMax = 1;
  state.errorTitle = "캡처를 불러오지 못했습니다";
  state.errorMessage = "요청한 캡처를 찾지 못했거나 이미지 자산이 비어 있습니다.";
  state.emptyTitle = DEFAULT_EMPTY_COPY.title;
  state.emptyMessage = DEFAULT_EMPTY_COPY.message;
  state.caption = "";
  state.cropModeEnabled = false;
  state.cropRect = null;
  state.appliedCropRect = null;
  state.cropInteraction = null;
  resetCropHistory();
  syncCropSummary();
  renderState();
}

function showError(title, message) {
  stopCropAutoScroll();
  state.view = "error";
  state.errorTitle = title;
  state.errorMessage = message;
  state.status = message;
  state.caption = "";
  state.loadingProgressVisible = false;
  state.cropModeEnabled = false;
  state.cropRect = null;
  state.appliedCropRect = null;
  state.cropInteraction = null;
  resetCropHistory();
  renderState();
}

function setLoadingProgress(current, max, label, message) {
  state.view = "loading";
  state.loadingProgressVisible = true;
  state.loadingProgressCurrent = current;
  state.loadingProgressMax = Math.max(1, max);
  if (typeof label === "string" && label.trim()) {
    state.loadingProgressLabel = label;
    state.status = label;
  }
  if (typeof message === "string" && message.trim()) {
    state.loadingMessage = message;
  }
  renderState();
}

async function initializeEditor() {
  const captureId = getCaptureIdFromQuery();
  if (!captureId) {
    showError(
      "캡처 ID가 없습니다",
      "캡처 결과에서 에디터를 열거나 주소 뒤에 ?captureId=... 값을 붙여 주세요."
    );
    return;
  }

  document.title = `ScrollCap - ${captureId}`;
  state.captureId = captureId;
  resetToLoading(DEFAULT_LOADING_COPY.message);

  try {
    setLoadingProgress(1, 4, "캡처 기록 확인 중", "로컬 저장소에서 캡처 기록을 찾는 중입니다.");
    const captureRecord = await loadCaptureRecord(captureId);
    state.captureRecord = captureRecord;

    setLoadingProgress(2, 4, "이미지 자산 확인 중", "저장된 결과 이미지와 스티칭 입력 정보를 검사하는 중입니다.");
    const loadPlan = getCaptureLoadPlan(captureRecord);
    if (!loadPlan) {
      throw new Error("캡처 기록에 결과 이미지나 전체 페이지 타일 정보가 없습니다.");
    }

    if (loadPlan.kind === "result") {
      try {
        const dataUrl = await loadAssetDataUrl(loadPlan.assetId);
        const imageSize = await measureImage(dataUrl);
        applyPreviewState(captureId, captureRecord, dataUrl, imageSize, false);
        return;
      } catch (assetError) {
        const stitchInputs = getStitchInputs(captureRecord);
        if (!stitchInputs) {
          throw assetError;
        }

        setLoadingProgress(
          2,
          3 + stitchInputs.frameAssetIds.length + stitchInputs.tiles.length,
          "캡처 다시 구성 중",
          "저장된 결과 이미지가 없어 프레임 타일을 다시 이어 붙이고 있습니다."
        );

        const stitched = await stitchCapture(captureId, captureRecord, stitchInputs);
        applyPreviewState(captureId, stitched.captureRecord, stitched.dataUrl, stitched.imageSize, true);
        return;
      }
    }

    const stitched = await stitchCapture(captureId, captureRecord, loadPlan);
    applyPreviewState(captureId, stitched.captureRecord, stitched.dataUrl, stitched.imageSize, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showError("캡처를 불러오지 못했습니다", message);
  }
}

function handleToolbarAction(action) {
  if (action === "clear") {
    state.cropModeEnabled = false;
    state.cropRect = null;
    state.cropInteraction = null;
    syncCropSummary();
    applyEmptyMode(true);
    state.status = "미리보기를 비웠습니다. 새로운 캡처 결과를 기다리는 중입니다.";
    renderState();
    return;
  }

  if (action === "crop-toggle") {
    toggleCropMode();
    return;
  }

  if (action === "undo-crop") {
    undoCropHistory();
    return;
  }

  if (action === "redo-crop") {
    redoCropHistory();
    return;
  }

  if (action === "crop-done") {
    completeCropMode();
    return;
  }

  if (action === "export-png") {
    void exportCapture("image/png");
    return;
  }

  if (action === "export-jpeg") {
    void exportCapture("image/jpeg");
  }
}

function toggleCropMode() {
  if (state.view !== "preview") {
    return;
  }

  state.cropModeEnabled = !state.cropModeEnabled;
  if (state.cropModeEnabled) {
    state.cropRect = cloneCropRect(state.appliedCropRect ?? state.cropRect);
  }
  if (!state.cropModeEnabled) {
    stopCropAutoScroll();
    state.cropInteraction = null;
  }
  syncCropSummary();
  state.status = state.cropModeEnabled
    ? "크롭 모드가 켜졌습니다. 미리보기에서 드래그해 영역을 만들거나 이동하세요."
    : "크롭 모드를 종료했습니다.";
  renderState();
  if (state.cropRect) {
    renderCropOverlay();
  }
}

function completeCropMode() {
  if (state.view !== "preview") {
    return;
  }

  stopCropAutoScroll();
  state.cropInteraction = null;
  state.cropModeEnabled = false;
  commitAppliedCrop(state.cropRect);
  state.status = state.appliedCropRect
    ? `크롭을 ${state.appliedCropRect.width} x ${state.appliedCropRect.height}px로 확정했습니다.`
    : "크롭을 완료했습니다.";
  renderState();
}

async function exportCapture(mimeType) {
  if (state.view !== "preview" || !els.captureImage || !state.imageSize) {
    return;
  }

  try {
    const exportSettings = await loadExportSettings();
    const activeCrop = state.cropModeEnabled
      ? normalizeCropRect(state.cropRect ?? state.appliedCropRect, state.imageSize)
      : normalizeCropRect(state.appliedCropRect ?? state.cropRect, state.imageSize);

    const region = activeCrop ?? {
      x: 0,
      y: 0,
      width: state.imageSize.width,
      height: state.imageSize.height,
    };

    state.status = `${mimeType === "image/jpeg" ? "JPEG" : "PNG"} 파일을 내보내는 중입니다.`;
    renderState();

    const outputs = await buildExportOutputs(els.captureImage, mimeType, region, exportSettings, Boolean(activeCrop));
    for (const output of outputs) {
      await downloadBlob(output.blob, output.filename, exportSettings.exportSaveAs, exportSettings.autoSaveSubfolder);
    }

    state.status =
      outputs.length > 1
        ? `${mimeType === "image/jpeg" ? "JPEG" : "PNG"} 파일 ${outputs.length}개 저장을 시작했습니다.`
        : `${mimeType === "image/jpeg" ? "JPEG" : "PNG"} 저장을 시작했습니다.`;
    renderState();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message);
  }
}

function handleCropPointerDown(event) {
  if (state.view !== "preview" || !state.cropModeEnabled || !state.imageSize) {
    return;
  }

  if (event.button !== 0 || event.isPrimary === false) {
    return;
  }

  const metrics = getImageDisplayMetrics();
  if (!metrics) {
    return;
  }

  const local = getLocalPointFromEvent(event, metrics.rect);
  if (!local) {
    return;
  }

  event.preventDefault();
  els.captureStageShell?.setPointerCapture?.(event.pointerId);

  const cropRect = normalizeCropRect(state.cropRect, state.imageSize);
  const cropDisplayRect = cropRect
    ? {
        x: cropRect.x * metrics.scaleX,
        y: cropRect.y * metrics.scaleY,
        width: cropRect.width * metrics.scaleX,
        height: cropRect.height * metrics.scaleY,
      }
    : null;

  const moveMode =
    Boolean(cropDisplayRect) &&
    local.x >= cropDisplayRect.x &&
    local.x <= cropDisplayRect.x + cropDisplayRect.width &&
    local.y >= cropDisplayRect.y &&
    local.y <= cropDisplayRect.y + cropDisplayRect.height;

  state.cropInteraction = {
    pointerId: event.pointerId,
    mode: moveMode ? "move" : "draw",
    startPoint: local,
    startCropRect: cropRect,
    lastPoint: local,
    lastClientX: event.clientX,
    lastClientY: event.clientY,
    hasMoved: false,
    cropOffset: moveMode && cropDisplayRect
      ? {
          x: local.x - cropDisplayRect.x,
          y: local.y - cropDisplayRect.y,
        }
      : null,
    metrics,
  };

  state.status = moveMode ? "크롭 박스를 이동하는 중입니다." : "드래그해서 크롭 영역을 지정하는 중입니다.";
  startCropAutoScroll();
  renderState();
}

function handleCropPointerMove(event) {
  const interaction = state.cropInteraction;
  if (!interaction || interaction.pointerId !== event.pointerId || state.view !== "preview") {
    return;
  }

  interaction.lastClientX = event.clientX;
  interaction.lastClientY = event.clientY;

  const metrics = getImageDisplayMetrics();
  if (!metrics) {
    return;
  }

  const local = getLocalPointFromClientPosition(event.clientX, event.clientY, metrics.rect);
  if (!local) {
    return;
  }

  event.preventDefault();

  if (interaction.mode === "move" && interaction.startCropRect) {
    interaction.hasMoved = true;
    moveCropSelection(local, metrics);
  } else {
    interaction.hasMoved = true;
    interaction.lastPoint = local;
    updateCropSelection(interaction.startPoint, local, metrics);
  }
}

function handleCropPointerEnd(event) {
  const interaction = state.cropInteraction;
  if (!interaction || interaction.pointerId !== event.pointerId) {
    return;
  }

  if (els.captureStageShell?.hasPointerCapture?.(event.pointerId)) {
    els.captureStageShell.releasePointerCapture(event.pointerId);
  }

  stopCropAutoScroll();
  state.cropInteraction = null;
  const activeCrop = normalizeCropRect(state.cropRect, state.imageSize);

  if (activeCrop) {
    state.cropRect = activeCrop;
    state.status = `크롭 영역이 ${activeCrop.width} x ${activeCrop.height}px로 설정되었습니다.`;
    renderState();
    return;
  }

  if (interaction.mode === "draw") {
    state.status = "크롭 모드가 켜졌습니다. 미리보기에서 드래그해 영역을 만들거나 이동하세요.";
    renderState();
    return;
  }

  if (interaction.hasMoved && state.cropRect) {
    state.status = `크롭 영역이 ${state.cropRect.width} x ${state.cropRect.height}px로 설정되었습니다.`;
  } else if (state.cropRect) {
    state.status = `크롭 영역이 ${state.cropRect.width} x ${state.cropRect.height}px로 설정되었습니다.`;
  } else if (interaction.mode === "draw") {
    state.status = "크롭 모드가 켜졌습니다. 미리보기에서 드래그해 영역을 만들거나 이동하세요.";
  }

  renderState();
}

function updateCropSelection(startPoint, endPoint, metrics) {
  if (!state.imageSize) {
    return;
  }

  const rect = getRectFromPoints(startPoint, endPoint, metrics, state.imageSize);
  state.cropRect = rect;
  syncCropSummary();
  state.status = `크롭 영역 ${rect.width} x ${rect.height}px`;
  renderCropOverlay();
  renderState();
  return;

  state.status = `크롭 영역 ${rect.width} x ${rect.height}px`;
  renderCropOverlay();
  renderState();
}

function moveCropSelection(localPoint, metrics) {
  const interaction = state.cropInteraction;
  if (!interaction?.startCropRect || !metrics || !state.imageSize) {
    return;
  }

  const { startCropRect, cropOffset } = interaction;
  const displayCropWidth = startCropRect.width * metrics.scaleX;
  const displayCropHeight = startCropRect.height * metrics.scaleY;
  const maxLeft = Math.max(0, metrics.rect.width - displayCropWidth);
  const maxTop = Math.max(0, metrics.rect.height - displayCropHeight);
  const nextLeft = clampNumber(localPoint.x - (cropOffset?.x ?? 0), 0, maxLeft);
  const nextTop = clampNumber(localPoint.y - (cropOffset?.y ?? 0), 0, maxTop);

  state.cropRect = normalizeCropRect(
    {
      x: nextLeft / metrics.scaleX,
      y: nextTop / metrics.scaleY,
      width: startCropRect.width,
      height: startCropRect.height,
    },
    state.imageSize
  );
  syncCropSummary();
  state.status = `크롭 박스를 ${state.cropRect.x}, ${state.cropRect.y} 위치로 이동했습니다.`;
  renderCropOverlay();
  renderState();
}

function startCropAutoScroll() {
  stopCropAutoScroll();

  const tick = () => {
    const interaction = state.cropInteraction;
    const shell = els.captureStageShell;
    if (!interaction || !shell || state.view !== "preview" || !state.cropModeEnabled) {
      state.cropAutoScrollFrameId = 0;
      return;
    }

    const deltaY = computeCropAutoScrollDelta(interaction.lastClientY, shell.getBoundingClientRect());
    if (deltaY !== 0) {
      const previousScrollTop = shell.scrollTop;
      const maxScrollTop = Math.max(0, shell.scrollHeight - shell.clientHeight);
      shell.scrollTop = clampNumber(shell.scrollTop + deltaY, 0, maxScrollTop);

      if (shell.scrollTop !== previousScrollTop) {
        applyCropInteractionAtClientPosition(interaction.lastClientX, interaction.lastClientY);
      }
    }

    state.cropAutoScrollFrameId = window.requestAnimationFrame(tick);
  };

  state.cropAutoScrollFrameId = window.requestAnimationFrame(tick);
}

function stopCropAutoScroll() {
  if (!state.cropAutoScrollFrameId) {
    return;
  }

  window.cancelAnimationFrame(state.cropAutoScrollFrameId);
  state.cropAutoScrollFrameId = 0;
}

function computeCropAutoScrollDelta(clientY, shellRect) {
  if (!Number.isFinite(clientY) || !shellRect) {
    return 0;
  }

  const topZone = shellRect.top + CROP_AUTOSCROLL_EDGE_PX;
  const bottomZone = shellRect.bottom - CROP_AUTOSCROLL_EDGE_PX;

  if (clientY < topZone) {
    const intensity = clampNumber((topZone - clientY) / CROP_AUTOSCROLL_EDGE_PX, 0, 1);
    return -Math.round(CROP_AUTOSCROLL_MIN_STEP_PX + intensity * (CROP_AUTOSCROLL_MAX_STEP_PX - CROP_AUTOSCROLL_MIN_STEP_PX));
  }

  if (clientY > bottomZone) {
    const intensity = clampNumber((clientY - bottomZone) / CROP_AUTOSCROLL_EDGE_PX, 0, 1);
    return Math.round(CROP_AUTOSCROLL_MIN_STEP_PX + intensity * (CROP_AUTOSCROLL_MAX_STEP_PX - CROP_AUTOSCROLL_MIN_STEP_PX));
  }

  return 0;
}

function applyCropInteractionAtClientPosition(clientX, clientY) {
  const interaction = state.cropInteraction;
  if (!interaction || state.view !== "preview") {
    return;
  }

  const metrics = getImageDisplayMetrics();
  if (!metrics) {
    return;
  }

  const local = getLocalPointFromClientPosition(clientX, clientY, metrics.rect);
  if (!local) {
    return;
  }

  if (interaction.mode === "move" && interaction.startCropRect) {
    interaction.hasMoved = true;
    interaction.lastPoint = local;
    moveCropSelection(local, metrics);
    return;
  }

  interaction.hasMoved = true;
  interaction.lastPoint = local;
  updateCropSelection(interaction.startPoint, local, metrics);
}

function getRectFromPoints(startPoint, endPoint, metrics, imageSize) {
  const left = Math.min(startPoint.x, endPoint.x);
  const top = Math.min(startPoint.y, endPoint.y);
  const width = Math.max(1, Math.abs(endPoint.x - startPoint.x));
  const height = Math.max(1, Math.abs(endPoint.y - startPoint.y));

  const scaleX = metrics?.scaleX || 1;
  const scaleY = metrics?.scaleY || 1;

  return normalizeCropRect(
    {
      x: left / scaleX,
      y: top / scaleY,
      width: width / scaleX,
      height: height / scaleY,
    },
    imageSize
  );
}

function getLocalPointFromEvent(event, rect) {
  return getLocalPointFromClientPosition(event.clientX, event.clientY, rect);
}

function getLocalPointFromClientPosition(clientX, clientY, rect) {
  const x = clampNumber(clientX - rect.left, 0, rect.width);
  const y = clampNumber(clientY - rect.top, 0, rect.height);

  if (Number.isNaN(x) || Number.isNaN(y)) {
    return null;
  }

  return { x, y };
}

async function downloadBlob(blob, filename, saveAs = true, subfolder = "") {
  if (!chrome?.downloads?.download) {
    throw new Error("이 환경에서는 chrome.downloads.download를 사용할 수 없습니다.");
  }

  const objectUrl = URL.createObjectURL(blob);
  const targetFilename = buildDownloadTargetPath(subfolder, filename);

  try {
    await new Promise((resolve, reject) => {
      chrome.downloads.download(
        {
          url: objectUrl,
          filename: targetFilename,
          saveAs,
        },
        (downloadId) => {
          const lastError = chrome.runtime?.lastError;
          if (lastError) {
            reject(new Error(lastError.message));
            return;
          }

          if (!downloadId && downloadId !== 0) {
            reject(new Error("다운로드를 시작하지 못했습니다."));
            return;
          }

          resolve(downloadId);
        }
      );
    });
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 15_000);
  }
}

function buildExportFilename(extension, hasCrop, region, filenameTemplate, partIndex = null, partCount = null) {
  const baseName = buildExportBaseName(hasCrop, region, filenameTemplate);
  const digits = Math.max(2, String(partCount || 0).length);
  const partSuffix =
    typeof partIndex === "number" && typeof partCount === "number" && partCount > 1
      ? `-part-${String(partIndex + 1).padStart(digits, "0")}`
      : "";
  return `${baseName}${partSuffix}.${extension}`;
}

async function loadExportSettings() {
  const module = await userSettingsModulePromise;
  const defaults = module?.DEFAULT_USER_SETTINGS ?? {
    exportSaveAs: true,
    includeCropSizeInFilename: true,
    suppressFixedElementsOnCapture: true,
    filenameTemplate: "{captureId}",
    autoSaveSubfolder: "",
    splitLargeExports: false,
  };

  if (typeof module?.loadUserSettings !== "function") {
    return defaults;
  }

  try {
    return {
      ...defaults,
      ...(await module.loadUserSettings()),
    };
  } catch {
    return defaults;
  }
}

async function buildExportOutputs(image, mimeType, region, exportSettings, hasCrop) {
  const extension = mimeType === "image/jpeg" ? "jpg" : "png";
  const fullBlob = await renderRegionBlob(image, mimeType, region);
  const shouldSplit =
    Boolean(exportSettings.splitLargeExports) &&
    isSplitEligibleCapture(state.captureRecord) &&
    fullBlob.size > LARGE_EXPORT_SPLIT_THRESHOLD_BYTES;

  if (!shouldSplit) {
    return [
      {
        blob: fullBlob,
        filename: buildExportFilename(
          extension,
          hasCrop && exportSettings.includeCropSizeInFilename,
          region,
          exportSettings.filenameTemplate
        ),
      },
    ];
  }

  const parts = await splitRegionBlobBySize(image, mimeType, region, LARGE_EXPORT_SPLIT_THRESHOLD_BYTES);
  return parts.map((part, index) => ({
    blob: part.blob,
    filename: buildExportFilename(
      extension,
      hasCrop && exportSettings.includeCropSizeInFilename,
      region,
      exportSettings.filenameTemplate,
      index,
      parts.length
    ),
  }));
}

async function renderRegionBlob(image, mimeType, region) {
  const canvas = createCanvas(region.width, region.height);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("내보내기용 2D 캔버스를 만들지 못했습니다.");
  }

  if (mimeType === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  context.drawImage(image, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
  return canvasToBlob(canvas, mimeType, mimeType === "image/jpeg" ? 0.92 : undefined);
}

async function splitRegionBlobBySize(image, mimeType, region, maxBytes) {
  const blob = await renderRegionBlob(image, mimeType, region);
  if (blob.size <= maxBytes || region.height <= 1) {
    return [{ region, blob }];
  }

  const splitCount = Math.max(2, Math.ceil(blob.size / maxBytes));
  const segmentHeight = Math.max(1, Math.ceil(region.height / splitCount));
  const parts = [];

  for (let offsetY = 0; offsetY < region.height; offsetY += segmentHeight) {
    const partHeight = Math.min(segmentHeight, region.height - offsetY);
    const partRegion = {
      x: region.x,
      y: region.y + offsetY,
      width: region.width,
      height: partHeight,
    };
    const nestedParts = await splitRegionBlobBySize(image, mimeType, partRegion, maxBytes);
    parts.push(...nestedParts);
  }

  return parts;
}

function buildExportBaseName(hasCrop, region, filenameTemplate) {
  const captureId = String(state.captureId || "capture");
  const sourceTitle = String(state.captureRecord?.source?.title || "").trim();
  const sourceUrl = String(state.captureRecord?.source?.url || "").trim();
  const createdAt = state.captureRecord?.createdAt ? new Date(state.captureRecord.createdAt) : new Date();
  const resolvedTemplate = String(filenameTemplate || "{captureId}")
    .replace(/\{title\}/gi, sourceTitle || "capture")
    .replace(/\{captureId\}/gi, captureId)
    .replace(/\{date\}/gi, formatDateToken(createdAt))
    .replace(/\{time\}/gi, formatTimeToken(createdAt))
    .replace(/\{host\}/gi, getSourceHost(sourceUrl))
    .replace(/\{kind\}/gi, String(state.captureRecord?.kind || "capture"))
    .replace(/\{width\}/gi, String(region.width))
    .replace(/\{height\}/gi, String(region.height));

  const baseName = sanitizeFilenamePart(resolvedTemplate) || sanitizeFilenamePart(captureId) || "capture";
  const cropSuffix = hasCrop ? `-crop-${region.width}x${region.height}` : "";
  return `${baseName}${cropSuffix}`;
}

function buildDownloadTargetPath(subfolder, filename) {
  const normalizedSubfolder = sanitizeDownloadSubfolder(subfolder);
  return normalizedSubfolder ? `${normalizedSubfolder}/${filename}` : filename;
}

function sanitizeDownloadSubfolder(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => sanitizePathSegment(segment))
    .filter(Boolean)
    .join("/");
}

function isSplitEligibleCapture(captureRecord) {
  const kind = captureRecord?.kind;
  return kind === "scroll-tab" || kind === "selection-tab";
}

function getSourceHost(url) {
  if (!url) {
    return "capture";
  }

  try {
    return sanitizeFilenamePart(new URL(url).hostname) || "capture";
  } catch {
    return "capture";
  }
}

function formatDateToken(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return formatDateToken(new Date());
  }

  return `${date.getFullYear()}-${padDateTimeToken(date.getMonth() + 1)}-${padDateTimeToken(date.getDate())}`;
}

function formatTimeToken(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return formatTimeToken(new Date());
  }

  return `${padDateTimeToken(date.getHours())}${padDateTimeToken(date.getMinutes())}${padDateTimeToken(date.getSeconds())}`;
}

function padDateTimeToken(value) {
  return String(value).padStart(2, "0");
}

function sanitizePathSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "_")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "");
}

function sanitizeFilenamePart(value) {
  return sanitizePathSegment(value) || "capture";
}

function applyPreviewState(captureId, captureRecord, dataUrl, imageSize, stitched) {
  stopCropAutoScroll();
  state.view = "preview";
  state.captureRecord = captureRecord;
  state.assetDataUrl = dataUrl;
  state.imageSize = imageSize;
  state.captureSource = formatCaptureSource(captureRecord);
  state.captureSourceUrl = getCaptureSourceUrl(captureRecord);
  state.fileSize = formatCaptureFileSize(captureRecord, dataUrl);
  state.caption = buildCaption(captureId, captureRecord, imageSize, stitched);
  state.status = stitched
    ? `캡처 ${captureId}를 이어 붙여 불러왔습니다.`
    : `캡처 ${captureId}를 불러왔습니다.`;
  state.loadingProgressVisible = false;
  state.emptyTitle = DEFAULT_EMPTY_COPY.title;
  state.emptyMessage = DEFAULT_EMPTY_COPY.message;
  state.cropModeEnabled = false;
  state.cropRect = null;
  state.appliedCropRect = null;
  state.cropInteraction = null;
  resetCropHistory();
  syncCropSummary();
  renderState();
}

async function loadCaptureRecord(captureId) {
  const recordKey = captureRecordKey(captureId);
  const recordResult = await chrome.storage.local.get(recordKey);
  const captureRecord = recordResult[recordKey];

  if (!captureRecord || typeof captureRecord !== "object") {
    throw new Error(`로컬 저장소에서 캡처 기록 ${captureId}를 찾지 못했습니다.`);
  }

  return captureRecord;
}

function getCaptureLoadPlan(captureRecord) {
  const resultAssetId = getResultAssetId(captureRecord);
  if (resultAssetId) {
    return {
      kind: "result",
      assetId: resultAssetId,
    };
  }

  const stitchInputs = getStitchInputs(captureRecord);
  if (stitchInputs) {
    return {
      kind: "stitch",
      ...stitchInputs,
    };
  }

  const fallbackAssetId = getAssetId(captureRecord);
  if (fallbackAssetId) {
    return {
      kind: "result",
      assetId: fallbackAssetId,
    };
  }

  return null;
}

function getStitchInputs(captureRecord) {
  const tiles = normalizeTiles(captureRecord);
  const frameAssetIds = getFrameAssetIds(captureRecord, tiles);

  if (!tiles.length || !frameAssetIds.length) {
    return null;
  }

  return {
    tiles,
    frameAssetIds,
  };
}

async function stitchCapture(captureId, captureRecord, stitchInputs) {
  const { tiles, frameAssetIds } = stitchInputs;
  const orderedTiles = tiles
    .map((tile, index) => ({
      ...tile,
      index,
      assetId: resolveTileFrameAssetId(tile, index, frameAssetIds),
    }))
    .sort((left, right) => {
      const delta = left.pageY - right.pageY;
      if (delta !== 0) {
        return delta;
      }
      return left.index - right.index;
    });

  const uniqueAssetIds = [...new Set(orderedTiles.map((tile) => tile.assetId).filter(Boolean))];
  if (!uniqueAssetIds.length) {
    throw new Error("스티칭에 필요한 프레임 자산을 캡처 기록에서 찾지 못했습니다.");
  }

  const totalSteps = 3 + uniqueAssetIds.length + orderedTiles.length;

  setLoadingProgress(
    2,
    totalSteps,
    "프레임 불러오는 중",
    `저장소에서 프레임 자산 ${uniqueAssetIds.length}개를 불러오는 중입니다.`
  );

  const frames = await loadFrameImages(uniqueAssetIds, (loadedCount, totalCount) => {
    setLoadingProgress(
      2 + loadedCount,
      totalSteps,
      "프레임 불러오는 중",
      `프레임 자산 ${totalCount}개 중 ${loadedCount}개를 불러왔습니다.`
    );
  });

  const stitched = await compositeStitchedImage(
    captureRecord,
    orderedTiles,
    frames,
    totalSteps,
    (current, label, message) => {
      setLoadingProgress(current, totalSteps, label, message);
    }
  );

  setLoadingProgress(
    totalSteps,
    totalSteps,
    "이어 붙인 결과 저장 중",
    "이어 붙인 결과 이미지를 IndexedDB에 저장하는 중입니다."
  );

  return await persistStitchedCapture(captureId, captureRecord, stitched.dataUrl, stitched.imageSize, frameAssetIds, orderedTiles);
}

async function loadFrameImages(assetIds, onProgress) {
  const frames = new Map();

  for (let index = 0; index < assetIds.length; index += 1) {
    const assetId = assetIds[index];
    const dataUrl = await loadAssetDataUrl(assetId);

    const image = await loadImageElement(dataUrl);
    frames.set(assetId, {
      assetId,
      dataUrl,
      image,
      width: image.naturalWidth,
      height: image.naturalHeight,
    });

    if (typeof onProgress === "function") {
      onProgress(index + 1, assetIds.length);
    }
  }

  return frames;
}

async function compositeStitchedImage(captureRecord, orderedTiles, frames, totalSteps, onProgress) {
  const firstFrame = frames.get(orderedTiles[0].assetId);
  if (!firstFrame) {
    throw new Error("스티칭에 필요한 첫 번째 프레임을 불러오지 못했습니다.");
  }

  const scale = getCapturePixelScale(captureRecord, firstFrame.width);
  let outputWidth = 0;
  let outputHeight = 0;
  const drawCommands = [];

  for (const tile of orderedTiles) {
    const frame = frames.get(tile.assetId);
    if (!frame) {
      throw new Error(`스티칭용 프레임 자산 ${tile.assetId}를 확인하지 못했습니다.`);
    }

    const cropTop = scaleValue(tile.cropTop, scale);
    const cropBottom = scaleValue(tile.cropBottom, scale);
    const cropLeft = scaleValue(tile.cropLeft, scale);
    const cropRight = scaleValue(tile.cropRight, scale);
    const pageX = scaleValue(tile.pageX, scale);
    const pageY = scaleValue(tile.pageY, scale);
    const sourceLeft = clampNumber(cropLeft, 0, frame.width);
    const sourceTop = clampNumber(cropTop, 0, frame.height);
    const sourceRight = clampNumber(cropRight, 0, Math.max(0, frame.width - sourceLeft));
    const sourceBottom = clampNumber(cropBottom, 0, Math.max(0, frame.height - sourceTop));
    const sourceWidth = Math.max(1, frame.width - sourceLeft - sourceRight);
    const sourceHeight = Math.max(1, frame.height - sourceTop - sourceBottom);
    const destinationX = pageX + sourceLeft;
    const destinationY = pageY + sourceTop;

    drawCommands.push({
      frame,
      sourceLeft,
      sourceTop,
      sourceWidth,
      sourceHeight,
      destinationX,
      destinationY,
      drawX: Math.round(destinationX),
      drawY: Math.round(destinationY),
      drawWidth: Math.max(1, Math.ceil(sourceWidth)),
      drawHeight: Math.max(1, Math.ceil(sourceHeight)),
    });

    outputWidth = Math.max(outputWidth, Math.round(destinationX) + Math.max(1, Math.ceil(sourceWidth)));
    outputHeight = Math.max(outputHeight, Math.round(destinationY) + Math.max(1, Math.ceil(sourceHeight)));
  }

  const canvas = createCanvas(Math.max(1, outputWidth), Math.max(1, outputHeight));
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("스티칭용 2D 캔버스 컨텍스트를 만들지 못했습니다.");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);

  drawCommands.forEach((command, index) => {
    context.drawImage(
      command.frame.image,
      command.sourceLeft,
      command.sourceTop,
      command.sourceWidth,
      command.sourceHeight,
      command.drawX,
      command.drawY,
      command.drawWidth,
      command.drawHeight
    );

    if (typeof onProgress === "function") {
      onProgress(
        2 + frames.size + index + 1,
        "캡처 이어 붙이는 중",
        `타일 ${drawCommands.length}개 중 ${index + 1}개를 캔버스에 배치했습니다.`
      );
    }
  });

  if (typeof onProgress === "function") {
    onProgress(
      totalSteps - 1,
      "이어 붙인 결과 저장 중",
      "이어 붙인 결과 이미지를 로컬 저장소에 기록하는 중입니다."
    );
  }

  const dataUrl = await canvasToDataUrl(canvas);
  const imageSize = await measureImage(dataUrl);
  return {
    dataUrl,
    imageSize,
  };
}

async function persistStitchedCapture(captureId, captureRecord, dataUrl, imageSize, frameAssetIds, orderedTiles) {
  const stitchedAssetId = createAssetId();
  const timestamp = new Date().toISOString();
  const existingAssetsById = isPlainObject(captureRecord?.assetsById) ? captureRecord.assetsById : {};
  const persistedAsset = await saveAssetDataUrl(stitchedAssetId, dataUrl);
  const updatedRecord = {
    ...captureRecord,
    updatedAt: timestamp,
    status: "ready",
    asset: stitchedAssetId,
    resultAssetId: stitchedAssetId,
    frameAssetIds: Array.isArray(captureRecord?.frameAssetIds) && captureRecord.frameAssetIds.length
      ? captureRecord.frameAssetIds
      : frameAssetIds,
    tiles: Array.isArray(captureRecord?.tiles) && captureRecord.tiles.length ? captureRecord.tiles : orderedTiles.map((tile) => tile.raw ?? tile),
    assetsById: {
      ...existingAssetsById,
      [stitchedAssetId]: {
        assetId: stitchedAssetId,
        role: "stitched-result",
        state: "ready",
        storage: persistedAsset.storage,
        storageKey: persistedAsset.storageKey,
        mime: "image/png",
        width: imageSize.width,
        height: imageSize.height,
        byteLength: dataUrl.length,
        derivedFrom: frameAssetIds,
        createdAt: timestamp,
      },
    },
  };

  try {
    await chrome.storage.local.set({
      [captureRecordKey(captureId)]: updatedRecord,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/quota/i.test(message)) {
      return {
        captureRecord: {
          ...captureRecord,
          updatedAt: timestamp,
          status: "ready",
        },
        dataUrl,
        imageSize,
      };
    }

    throw error;
  }

  return {
    captureRecord: updatedRecord,
    dataUrl,
    imageSize,
  };
}

function getCaptureIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get("captureId")?.trim() ?? "";
}

function captureRecordKey(captureId) {
  return `${CAPTURE_KEY_PREFIX}${captureId}`;
}

function assetKey(assetId) {
  return `${ASSET_KEY_PREFIX}${assetId}`;
}

function createAssetId() {
  return `asset-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getResultAssetId(captureRecord) {
  return (
    captureRecord?.resultAssetId ??
    captureRecord?.result?.assetId ??
    captureRecord?.result?.id ??
    captureRecord?.outputAssetId ??
    captureRecord?.stitchedAssetId ??
    ""
  )
    .toString()
    .trim();
}

function getAssetId(captureRecord) {
  const asset = captureRecord?.asset;

  if (typeof asset === "string") {
    return asset.trim();
  }

  if (asset && typeof asset === "object") {
    return (
      asset.assetId ??
      asset.id ??
      asset.key ??
      asset.assetKey ??
      asset.value ??
      ""
    )
      .toString()
      .trim();
  }

  return (
    captureRecord?.assetId ??
    captureRecord?.imageAssetId ??
    captureRecord?.image?.assetId ??
    ""
  )
    .toString()
    .trim();
}

function getFrameAssetIds(captureRecord, tiles = []) {
  const directIds = normalizeAssetIdList(captureRecord?.frameAssetIds);
  if (directIds.length) {
    return directIds;
  }

  const tileIds = tiles
    .map((tile, index) => resolveTileFrameAssetId(tile, index, []))
    .filter(Boolean);

  if (tileIds.length) {
    return [...new Set(tileIds)];
  }

  return [];
}

function normalizeTiles(captureRecord) {
  const rawTiles = Array.isArray(captureRecord?.tiles) ? captureRecord.tiles : [];

  return rawTiles.map((tile, index) => ({
    raw: tile,
    index,
    pageX: readNumericValue(tile, ["pageX", "x", "left", "scrollX", "scrollLeft"], 0),
    pageY: readNumericValue(tile, ["pageY", "y", "top", "scrollY", "scrollTop"], 0),
    cropLeft: readNumericValue(tile, ["cropLeft", "leftCrop", "trimLeft"], 0),
    cropTop: readNumericValue(tile, ["cropTop", "topCrop", "trimTop"], 0),
    cropRight: readNumericValue(tile, ["cropRight", "rightCrop", "trimRight"], 0),
    cropBottom: readNumericValue(tile, ["cropBottom", "bottomCrop", "trimBottom"], 0),
  }));
}

function resolveTileFrameAssetId(tile, index, frameAssetIds) {
  return normalizeAssetId(
    tile?.frameAssetId ??
      tile?.assetId ??
      tile?.asset ??
      tile?.imageAssetId ??
      tile?.id ??
      frameAssetIds?.[index] ??
      ""
  );
}

function normalizeAssetIdList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => normalizeAssetId(item)).filter(Boolean);
}

function normalizeAssetId(value) {
  return value == null ? "" : value.toString().trim();
}

function readNumericValue(source, keys, fallback) {
  for (const key of keys) {
    const value = source?.[key];
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return fallback;
}

function scaleValue(value, scale) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return numeric * scale;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getCapturePixelScale(captureRecord, firstFrameWidth) {
  const explicitCandidates = [
    captureRecord?.pixelRatio,
    captureRecord?.devicePixelRatio,
    captureRecord?.scale,
    captureRecord?.metrics?.devicePixelRatio,
    captureRecord?.page?.devicePixelRatio,
  ];

  for (const candidate of explicitCandidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
  }

  const viewportWidth =
    captureRecord?.metrics?.viewportWidth ??
    captureRecord?.page?.viewportWidth ??
    captureRecord?.viewport?.width ??
    captureRecord?.source?.viewportWidth ??
    null;

  if (Number.isFinite(Number(viewportWidth)) && Number(viewportWidth) > 0 && Number(firstFrameWidth) > 0) {
    return Number(firstFrameWidth) / Number(viewportWidth);
  }

  return 1;
}

function formatCaptureSource(captureRecord) {
  const title = captureRecord?.source?.title?.trim() ?? "";
  const url = getCaptureSourceUrl(captureRecord);

  if (title) {
    return title;
  }

  if (url) {
    return safeHostname(url) || url;
  }

  return DEFAULT_SUMMARY.captureSource;
}

function getCaptureSourceUrl(captureRecord) {
  const url = captureRecord?.source?.url;
  return typeof url === "string" ? url.trim() : "";
}

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function getFrameCountLabel(captureRecord) {
  const tileCount = Array.isArray(captureRecord?.tiles) ? captureRecord.tiles.length : 0;
  if (tileCount > 0) {
    return tileCount === 1 ? "타일 1개" : `타일 ${tileCount}개`;
  }

  const frameCount = Array.isArray(captureRecord?.frameAssetIds) ? captureRecord.frameAssetIds.length : 0;
  if (frameCount > 0) {
    return frameCount === 1 ? "프레임 1개" : `프레임 ${frameCount}개`;
  }

  return "";
}

function buildCaption(captureId, captureRecord, imageSize, stitched) {
  const captureKind = stitched
    ? "이어 붙인 캡처"
    : formatCaptureKind(captureRecord?.kind);
  const source = formatCaptureSource(captureRecord);
  const frameLabel = getFrameCountLabel(captureRecord);
  const frameSuffix = frameLabel ? ` · ${frameLabel}` : "";

  return `${captureKind} ${captureId} · ${source}${frameSuffix} · ${imageSize.width} x ${imageSize.height}px`;
}

function formatCaptureKind(kind) {
  switch (String(kind || "").trim()) {
    case "visible-tab":
      return "현재 화면 캡처";
    case "selection-tab":
      return "선택 영역 캡처";
    case "full-page":
    case "full-page-tab":
      return "전체 페이지 캡처";
    default:
      return "캡처";
  }
}

function formatCaptureFileSize(captureRecord, dataUrl) {
  const byteLength = estimateDataUrlByteLength(dataUrl) || getStoredAssetByteLength(captureRecord);
  return byteLength > 0 ? formatByteSize(byteLength) : DEFAULT_SUMMARY.fileSize;
}

function getStoredAssetByteLength(captureRecord) {
  const assetsById = isPlainObject(captureRecord?.assetsById) ? captureRecord.assetsById : {};
  const assetIds = [getResultAssetId(captureRecord), getAssetId(captureRecord)].filter(Boolean);

  for (const assetId of assetIds) {
    const byteLength = Number(assetsById?.[assetId]?.byteLength);
    if (Number.isFinite(byteLength) && byteLength > 0) {
      return byteLength;
    }
  }

  return 0;
}

function estimateDataUrlByteLength(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
    return 0;
  }

  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) {
    return 0;
  }

  const encoded = dataUrl.slice(commaIndex + 1);
  const paddingMatch = encoded.match(/=+$/);
  const paddingLength = paddingMatch ? paddingMatch[0].length : 0;
  return Math.max(0, Math.floor((encoded.length * 3) / 4) - paddingLength);
}

function formatByteSize(byteLength) {
  const units = ["B", "KB", "MB", "GB"];
  let value = Number(byteLength);
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = unitIndex === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      resolve(image);
    };

    image.onerror = () => {
      reject(new Error("저장된 이미지 데이터를 해독하지 못했습니다."));
    };

    image.src = src;
  });
}

function measureImage(src) {
  return loadImageElement(src).then((image) => ({
    width: image.naturalWidth,
    height: image.naturalHeight,
  }));
}

function canvasToDataUrl(canvas) {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== "function") {
      try {
        resolve(canvas.toDataURL("image/png"));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
      return;
    }

    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("이어 붙인 캔버스를 이미지 blob으로 변환하지 못했습니다."));
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        resolve(String(reader.result ?? ""));
      };
      reader.onerror = () => {
        reject(new Error("이어 붙인 이미지 blob을 data URL로 다시 읽지 못했습니다."));
      };
      reader.readAsDataURL(blob);
    }, "image/png");
  });
}

function canvasToBlob(canvas, mimeType = "image/png", quality) {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob === "function") {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("내보내기용 캔버스를 blob으로 변환하지 못했습니다."));
          return;
        }

        resolve(blob);
      }, mimeType, quality);
      return;
    }

    try {
      const dataUrl = canvas.toDataURL(mimeType, quality);
      fetch(dataUrl)
        .then((response) => response.blob())
        .then(resolve)
        .catch((error) => {
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

async function loadAssetDataUrl(assetId) {
  const indexedDbDataUrl = await loadAssetDataUrlFromIndexedDb(assetId);
  if (indexedDbDataUrl) {
    return indexedDbDataUrl;
  }

  const dataUrl = await loadAssetDataUrlFromLegacyStorage(assetId);

  if (!dataUrl) {
    throw new Error(`Image asset ${assetId} was not found in IndexedDB or local storage.`);
  }

  return dataUrl;
}

async function saveAssetDataUrl(assetId, dataUrl) {
  const assetStore = await getAssetStore();
  const writer = resolveAssetStoreWriter(assetStore);

  if (writer) {
    try {
      await writer(assetId, dataUrl, {
        storage: "idb",
        createdAt: new Date().toISOString()
      });
      return {
        storage: "idb",
        storageKey: assetId
      };
    } catch {
      // Fall through to legacy local storage.
    }
  }

  await chrome.storage.local.set({
    [assetKey(assetId)]: dataUrl
  });

  return {
    storage: "storageLocal",
    storageKey: assetKey(assetId)
  };
}

async function loadAssetDataUrlFromIndexedDb(assetId) {
  const assetStore = await getAssetStore();
  if (!assetStore) {
    return null;
  }

  const reader = resolveAssetStoreReader(assetStore);
  if (!reader) {
    return null;
  }

  try {
    const assetValue = await reader(assetId);
    return await normalizeAssetDataUrl(assetValue);
  } catch {
    return null;
  }
}

async function loadAssetDataUrlFromLegacyStorage(assetId) {
  const assetResult = await chrome.storage.local.get(assetKey(assetId));
  const assetValue = assetResult[assetKey(assetId)];
  return await normalizeAssetDataUrl(assetValue);
}

async function getAssetStore() {
  const module = await assetStoreModulePromise;
  if (!module) {
    return null;
  }

  return module.default && typeof module.default === "object"
    ? { ...module, ...module.default }
    : module;
}

function resolveAssetStoreReader(assetStore) {
  const candidates = [
    "readAssetDataUrl",
    "getAssetDataUrl",
    "loadAssetDataUrl",
    "readAssetBlob",
    "getAssetBlob",
    "loadAssetBlob",
    "readAsset",
    "getAsset",
    "loadAsset",
  ];

  for (const name of candidates) {
    if (typeof assetStore?.[name] === "function") {
      return assetStore[name].bind(assetStore);
    }
  }

  return null;
}

function resolveAssetStoreWriter(assetStore) {
  const candidates = [
    "putAssetFromDataUrl",
    "putAssetDataUrl",
    "writeAssetDataUrl",
    "saveAssetDataUrl"
  ];

  for (const name of candidates) {
    if (typeof assetStore?.[name] === "function") {
      return assetStore[name].bind(assetStore);
    }
  }

  return null;
}

async function normalizeAssetDataUrl(assetValue) {
  if (typeof assetValue === "string") {
    return assetValue.trim();
  }

  if (assetValue instanceof Blob) {
    return await blobToDataUrl(assetValue);
  }

  if (assetValue && typeof assetValue === "object") {
    const dataUrl =
      assetValue.dataUrl ??
      assetValue.dataURL ??
      assetValue.url ??
      assetValue.value ??
      "";

    if (typeof dataUrl === "string") {
      return dataUrl.trim();
    }

    if (dataUrl instanceof Blob) {
      return await blobToDataUrl(dataUrl);
    }

    if (assetValue.blob instanceof Blob) {
      return await blobToDataUrl(assetValue.blob);
    }

    if (assetValue.data instanceof Blob) {
      return await blobToDataUrl(assetValue.data);
    }
  }

  if (assetValue instanceof ArrayBuffer || ArrayBuffer.isView(assetValue)) {
    return await blobToDataUrl(new Blob([assetValue]));
  }

  return "";
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      resolve(String(reader.result ?? ""));
    };
    reader.onerror = () => {
      reject(new Error("저장된 이미지 blob을 data URL로 변환하지 못했습니다."));
    };
    reader.readAsDataURL(blob);
  });
}

window.editorHooks = {
  setSummary(nextState = {}) {
    if (typeof nextState.captureSource === "string") {
      state.captureSource = nextState.captureSource;
    }
    if (typeof nextState.captureSourceUrl === "string") {
      state.captureSourceUrl = nextState.captureSourceUrl;
    }
    if (typeof nextState.fileSize === "string") {
      state.fileSize = nextState.fileSize;
    }
    if (typeof nextState.status === "string") {
      state.status = nextState.status;
    }
    if (typeof nextState.empty === "boolean") {
      applyEmptyMode(Boolean(nextState.empty));
      return;
    }

    renderState();
  },
  setStatus,
  setEmptyMode(isEmpty) {
    applyEmptyMode(Boolean(isEmpty));
  },
};

renderState();
