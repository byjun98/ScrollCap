import { putAssetFromDataUrl } from "../shared/asset-store";
import { APP_VERSION, STORAGE_KEYS } from "../shared/constants";
import { DEFAULT_USER_SETTINGS, loadUserSettings } from "../shared/user-settings";
import {
  captureStorageKey,
  computeScrollPositions,
  computeSelectionScrollPositions,
  createAssetId,
  createCaptureId,
  delay,
  isMissingSelectionListenerError,
  normalizeSelectionRect,
} from "../shared/capture-utils";
import type { PageMetrics, CaptureRecord } from "../shared/capture-types";

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(STORAGE_KEYS.lastCaptureId);
  if (typeof existing[STORAGE_KEYS.lastCaptureId] === "undefined") {
    await chrome.storage.local.set({
      [STORAGE_KEYS.lastCaptureId]: null,
    });
  }
});

chrome.commands.onCommand.addListener(async (command: string) => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) {
    return;
  }

  switch (command) {
    case "capture-visible":
      await runVisibleCapture(tab.id);
      return;
    case "capture-full-page":
      await runFullPageCapture(tab.id);
      return;
    case "capture-selection":
      await runSelectionCapture(tab.id);
      return;
    default:
      return;
  }
});

chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
  void handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });

  return true;
});

async function handleMessage(message: any, sender: any) {
  switch (message?.type) {
    case "app/ping":
      return {
        ok: true,
        version: APP_VERSION,
      };
    case "capture/getLastCaptureId":
      return {
        ok: true,
        captureId: await getLastCaptureId(),
      };
    case "capture/startVisible":
      return startVisibleCapture(message, sender);
    case "capture/startFullPage":
      return startFullPageCapture(message, sender);
    case "capture/startSelection":
      return startSelectionCapture(message, sender);
    case "content/getPageMetrics":
      return getPageMetricsForSender(sender);
    default:
      return {
        ok: false,
        error: `알 수 없는 메시지 타입입니다: ${message?.type ?? "undefined"}`,
      };
  }
}

async function startVisibleCapture(message: any, sender: any) {
  const tabId = message?.tabId ?? sender.tab?.id;
  if (!tabId) {
    throw new Error("캡처를 시작하려면 탭 정보가 필요합니다.");
  }

  return runVisibleCapture(tabId);
}

async function startFullPageCapture(message: any, sender: any) {
  const tabId = message?.tabId ?? sender.tab?.id;
  if (!tabId) {
    throw new Error("전체 페이지 캡처를 시작하려면 탭 정보가 필요합니다.");
  }

  return runFullPageCapture(tabId);
}

async function startSelectionCapture(message: any, sender: any) {
  const tabId = message?.tabId ?? sender.tab?.id;
  if (!tabId) {
    throw new Error("선택 영역 캡처를 시작하려면 탭 정보가 필요합니다.");
  }

  return runSelectionCapture(tabId);
}

async function getPageMetricsForSender(sender: any) {
  const tabId = sender.tab?.id;
  if (!tabId) {
    throw new Error("페이지 정보를 확인하려면 탭 정보가 필요합니다.");
  }

  const response = await getPageMetrics(tabId);

  return {
    ok: true,
    metrics: response?.metrics ?? null,
  };
}

async function ensureContentScript(tabId: number) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content-script.js"],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Cannot access|Cannot inject|chrome:|edge:|about:|extensions/i.test(message)) {
      throw new Error("이 페이지는 스크립트 주입을 막고 있어 전체 스크롤 캡처를 사용할 수 없습니다.");
    }

    throw error;
  }
}

async function runVisibleCapture(tabId: number) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.id) {
    throw new Error("대상 탭의 ID를 확인하지 못했습니다.");
  }

  const captureId = createCaptureId();
  const assetId = createAssetId();
  const pageMetrics = await getPageMetrics(tab.id).catch(() => null);
  const imageDataUrl = await captureTabImage(tab.windowId);

  const record: CaptureRecord = {
    id: captureId,
    kind: "visible-tab",
    status: "ready",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: {
      tabId: tab.id,
      windowId: tab.windowId,
      title: tab.title ?? "",
      url: tab.url ?? "",
    },
    pending: {
      step: null,
      current: 1,
      total: 1,
      unit: "frames",
      updatedAt: new Date().toISOString(),
      error: null,
    },
    metrics: pageMetrics?.metrics ?? null,
    page: pageMetrics?.metrics ?? null,
    asset: assetId,
    frameAssetIds: [assetId],
    resultAssetId: assetId,
    assetsById: {
      [assetId]: {
        assetId,
        role: "base",
        state: "ready",
        storage: "idb",
        storageKey: assetId,
        mime: "image/png",
        width: pageMetrics?.metrics ? Math.round(pageMetrics.metrics.viewportWidth * pageMetrics.metrics.devicePixelRatio) : null,
        height: pageMetrics?.metrics ? Math.round(pageMetrics.metrics.viewportHeight * pageMetrics.metrics.devicePixelRatio) : null,
        byteLength: imageDataUrl.length,
        derivedFrom: [],
        createdAt: new Date().toISOString(),
      },
    },
    error: null,
  };

  await persistAssetData(assetId, imageDataUrl);
  await saveCaptureRecord(record);
  await openEditor(captureId);

  return {
    ok: true,
    captureId,
  };
}

async function runFullPageCapture(tabId: number) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.id) {
    throw new Error("대상 탭의 ID를 확인하지 못했습니다.");
  }

  const metricsResponse = await getPageMetrics(tab.id);
  const metrics: PageMetrics | null = metricsResponse?.metrics;
  if (!metrics) {
    throw new Error("전체 페이지 캡처에 필요한 페이지 정보를 수집하지 못했습니다.");
  }

  const overlapPx = Math.max(48, Math.min(120, Math.floor(metrics.viewportHeight * 0.12)));
  const positions = computeScrollPositions(metrics.scrollHeight, metrics.viewportHeight, overlapPx);
  const settings = await loadCaptureSettings();
  const captureId = createCaptureId();
  const record: CaptureRecord = {
    id: captureId,
    kind: "scroll-tab",
    status: "capturing",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: {
      tabId: tab.id,
      windowId: tab.windowId,
      title: tab.title ?? "",
      url: tab.url ?? "",
    },
    pending: {
      step: "capture",
      current: 0,
      total: positions.length,
      unit: "frames",
      updatedAt: new Date().toISOString(),
      error: null,
    },
    metrics: {
      ...metrics,
      overlapPx,
      tileCount: positions.length,
    },
    page: {
      ...metrics,
      overlapPx,
      tileCount: positions.length,
    },
    asset: null,
    frameAssetIds: [],
    resultAssetId: null,
    assetsById: {},
    tiles: [],
    error: null,
  };

  await saveCaptureRecord(record);

  try {
    await preparePageForCapture(tab.id, {
      suppressFixedElements: settings.suppressFixedElementsOnCapture,
    });

    for (let index = 0; index < positions.length; index += 1) {
      const targetY = positions[index];
      const scrollResult = await scrollToPosition(tab.id, {
        index,
        x: 0,
        y: targetY,
      });

      await delay(550);

      const imageDataUrl = await captureTabImage(tab.windowId);
      const assetId = createAssetId();
      const previousTile = record.tiles?.[record.tiles.length - 1] ?? null;
      const cropTop = previousTile ? Math.max(0, (previousTile.pageY as number) + metrics.viewportHeight - scrollResult.actualY) : 0;

      const tile = {
        index,
        pageX: scrollResult.actualX,
        pageY: scrollResult.actualY,
        width: metrics.viewportWidth,
        height: metrics.viewportHeight,
        cropTop,
        cropBottom: 0,
        assetId,
      };

      record.frameAssetIds!.push(assetId);
      record.tiles!.push(tile);
      record.assetsById![assetId] = {
        assetId,
        role: "frame",
        state: "ready",
        storage: "idb",
        storageKey: assetId,
        mime: "image/png",
        width: Math.round(metrics.viewportWidth * metrics.devicePixelRatio),
        height: Math.round(metrics.viewportHeight * metrics.devicePixelRatio),
        byteLength: imageDataUrl.length,
        derivedFrom: [],
        createdAt: new Date().toISOString(),
      };

      await persistAssetData(assetId, imageDataUrl);

      record.pending!.current = index + 1;
      record.updatedAt = new Date().toISOString();
      record.pending!.updatedAt = record.updatedAt;
      await saveCaptureRecord(record);
    }

    record.status = "stitching";
    record.pending!.step = "stitch";
    record.updatedAt = new Date().toISOString();
    record.pending!.updatedAt = record.updatedAt;
    await saveCaptureRecord(record);
    await openEditor(captureId);
  } catch (error) {
    record.status = "failed";
    record.error = {
      message: error instanceof Error ? error.message : String(error),
    };
    record.pending!.error = {
      code: "FULL_CAPTURE_FAILED",
      message: record.error.message,
      retryable: true,
    };
    record.updatedAt = new Date().toISOString();
    record.pending!.updatedAt = record.updatedAt;
    await saveCaptureRecord(record);
    throw error;
  } finally {
    await restoreScrollPosition(tab.id, {
      x: metrics.scrollX,
      y: metrics.scrollY,
    }).catch(() => null);
    await cleanupPageAfterCapture(tab.id).catch(() => null);
  }

  return {
    ok: true,
    captureId,
  };
}

async function runSelectionCapture(tabId: number) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.id) {
    throw new Error("대상 탭의 ID를 확인하지 못했습니다.");
  }

  const metricsResponse = await getPageMetrics(tab.id);
  const metrics: PageMetrics | null = metricsResponse?.metrics;
  if (!metrics) {
    throw new Error("선택 영역 캡처에 필요한 페이지 정보를 수집하지 못했습니다.");
  }

  const selectionResponse = await requestSelectionRect(tab.id, metrics);
  if (selectionResponse?.cancelled || selectionResponse?.canceled) {
    return {
      ok: false,
      cancelled: true,
      error: "선택 영역 캡처가 취소되었습니다.",
    };
  }

  const selectionRect = normalizeSelectionRect(selectionResponse, metrics);
  if (!selectionRect) {
    throw new Error("선택한 영역 좌표를 확인하지 못했습니다.");
  }

  const overlapPx = Math.max(48, Math.min(120, Math.floor(metrics.viewportHeight * 0.12)));
  const positions = computeSelectionScrollPositions(selectionRect, metrics, overlapPx);
  const settings = await loadCaptureSettings();
  const captureId = createCaptureId();
  const record: CaptureRecord = {
    id: captureId,
    kind: "selection-tab",
    status: "capturing",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: {
      tabId: tab.id,
      windowId: tab.windowId,
      title: tab.title ?? "",
      url: tab.url ?? "",
    },
    pending: {
      step: "capture",
      current: 0,
      total: positions.length,
      unit: "frames",
      updatedAt: new Date().toISOString(),
      error: null,
    },
    metrics: {
      ...metrics,
      selectionRect,
      overlapPx,
      tileCount: positions.length,
    },
    page: {
      ...metrics,
      selectionRect,
      overlapPx,
      tileCount: positions.length,
    },
    selection: selectionRect,
    asset: null,
    frameAssetIds: [],
    resultAssetId: null,
    assetsById: {},
    tiles: [],
    error: null,
  };

  await saveCaptureRecord(record);

  try {
    await preparePageForCapture(tab.id, {
      suppressFixedElements: settings.suppressFixedElementsOnCapture,
    });
    const baseScrollX = Math.round(Number(metrics.scrollX) || 0);
    let previousVisibleBottom = selectionRect.top;

    for (let index = 0; index < positions.length; index += 1) {
      const targetY = positions[index];
      const scrollResult = await scrollToPosition(tab.id, {
        index,
        x: baseScrollX,
        y: targetY,
      });

      await delay(550);

      const imageDataUrl = await captureTabImage(tab.windowId);
      const assetId = createAssetId();
      const viewportTop = Math.round(scrollResult.actualY);
      const viewportBottom = viewportTop + Math.round(metrics.viewportHeight);
      const visibleTop = Math.max(selectionRect.top, viewportTop, previousVisibleBottom);
      const visibleBottom = Math.min(selectionRect.bottom, viewportBottom);

      if (visibleBottom <= visibleTop) {
        continue;
      }

      const viewportLeft = Math.round(scrollResult.actualX);
      const cropLeft = Math.max(0, Math.round(selectionRect.left - viewportLeft));
      const cropRight = Math.max(0, Math.round(metrics.viewportWidth - cropLeft - selectionRect.width));
      const cropTop = Math.max(0, Math.round(visibleTop - viewportTop));
      const cropBottom = Math.max(0, Math.round(viewportBottom - visibleBottom));

      const tile = {
        index,
        pageX: Math.round(viewportLeft - selectionRect.left),
        pageY: Math.round(viewportTop - selectionRect.top),
        width: metrics.viewportWidth,
        height: metrics.viewportHeight,
        cropLeft,
        cropRight,
        cropTop,
        cropBottom,
        assetId,
      };

      record.frameAssetIds!.push(assetId);
      record.tiles!.push(tile);
      record.assetsById![assetId] = {
        assetId,
        role: "frame",
        state: "ready",
        storage: "idb",
        storageKey: assetId,
        mime: "image/png",
        width: Math.round(metrics.viewportWidth * metrics.devicePixelRatio),
        height: Math.round(metrics.viewportHeight * metrics.devicePixelRatio),
        byteLength: imageDataUrl.length,
        derivedFrom: [],
        createdAt: new Date().toISOString(),
      };

      await persistAssetData(assetId, imageDataUrl);

      record.pending!.current = index + 1;
      record.updatedAt = new Date().toISOString();
      record.pending!.updatedAt = record.updatedAt;
      await saveCaptureRecord(record);
      previousVisibleBottom = visibleBottom;
    }

    record.status = "stitching";
    record.pending!.step = "stitch";
    record.updatedAt = new Date().toISOString();
    record.pending!.updatedAt = record.updatedAt;
    await saveCaptureRecord(record);
    await openEditor(captureId);
  } catch (error) {
    record.status = "failed";
    record.error = {
      message: error instanceof Error ? error.message : String(error),
    };
    record.pending!.error = {
      code: "SELECTION_CAPTURE_FAILED",
      message: record.error.message,
      retryable: true,
    };
    record.updatedAt = new Date().toISOString();
    record.pending!.updatedAt = record.updatedAt;
    await saveCaptureRecord(record);
    throw error;
  } finally {
    await restoreScrollPosition(tab.id, {
      x: metrics.scrollX,
      y: metrics.scrollY,
    }).catch(() => null);
    await cleanupPageAfterCapture(tab.id).catch(() => null);
  }

  return {
    ok: true,
    captureId,
  };
}

async function getPageMetrics(tabId: number) {
  await ensureContentScript(tabId);
  return chrome.tabs.sendMessage(tabId, {
    type: "content/getPageMetrics",
  });
}

async function requestSelectionRect(tabId: number, metrics: PageMetrics) {
  const messageCandidates = ["content/startSelectionCapture", "content/startSelection", "content/beginSelectionCapture"];
  const payload = {
    metrics,
    pageScroll: {
      x: metrics.scrollX,
      y: metrics.scrollY,
    },
    viewport: {
      width: metrics.viewportWidth,
      height: metrics.viewportHeight,
    },
  };

  let lastError: unknown = null;

  for (const type of messageCandidates) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type,
        ...payload,
      });

      if (!response) {
        continue;
      }

      if (response.ok === false) {
        if (response.cancelled || response.canceled) {
          return {
            ok: false,
            cancelled: true,
          };
        }

        throw new Error(response.error || "선택 영역 UI에서 오류를 반환했습니다.");
      }

      return response;
    } catch (error) {
      lastError = error;
      if (!isMissingSelectionListenerError(error)) {
        throw error;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error("이 페이지에서 선택 영역 UI를 시작하지 못했습니다.");
}

async function scrollToPosition(tabId: number, payload: any) {
  await ensureContentScript(tabId);
  return chrome.tabs.sendMessage(tabId, {
    type: "content/scrollToPosition",
    ...payload,
  });
}

async function restoreScrollPosition(tabId: number, payload: any) {
  await ensureContentScript(tabId);
  return chrome.tabs.sendMessage(tabId, {
    type: "content/restoreScrollPosition",
    ...payload,
  });
}

async function preparePageForCapture(tabId: number, options: { suppressFixedElements?: boolean } = {}) {
  await ensureContentScript(tabId);
  return chrome.tabs.sendMessage(tabId, {
    type: "content/prepareForCapture",
    options,
  });
}

async function cleanupPageAfterCapture(tabId: number) {
  await ensureContentScript(tabId);
  return chrome.tabs.sendMessage(tabId, {
    type: "content/cleanupAfterCapture",
  });
}

async function getLastCaptureId() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.lastCaptureId);
  return result[STORAGE_KEYS.lastCaptureId] ?? null;
}

async function openEditor(captureId: string) {
  const url = chrome.runtime.getURL(`editor.html?captureId=${encodeURIComponent(captureId)}`);
  await chrome.tabs.create({ url });
}

async function saveCaptureRecord(record: CaptureRecord) {
  await chrome.storage.local.set({
    [captureStorageKey(record.id)]: record,
    [STORAGE_KEYS.lastCaptureId]: record.id,
  });
}

async function persistAssetData(assetId: string, imageDataUrl: string) {
  try {
    await putAssetFromDataUrl(assetId, imageDataUrl, {
      storage: "idb",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/quota|space|storage/i.test(message)) {
      throw new Error("IndexedDB에 캡처 프레임을 저장하지 못했습니다.");
    }

    throw error;
  }
}

async function captureTabImage(windowId: number) {
  try {
    return await chrome.tabs.captureVisibleTab(windowId, {
      format: "png",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/activeTab|permission|capture/i.test(message)) {
      throw new Error("Chrome이 이 탭을 캡처하지 못했습니다. 캡처하려는 페이지에서 확장을 직접 실행해 보세요.");
    }

    throw error;
  }
}

async function loadCaptureSettings() {
  try {
    return await loadUserSettings();
  } catch {
    return { ...DEFAULT_USER_SETTINGS };
  }
}
