import { MIN_SELECTION_SIZE } from "./constants";
import type { PageMetrics, SelectionRect, SelectionResult } from "./capture-types";

export function captureStorageKey(captureId: string) {
  return `scrollCapture.capture.${captureId}`;
}

export function assetStorageKey(assetId: string) {
  return `scrollCapture.asset.${assetId}`;
}

export function createCaptureId() {
  return `capture-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createAssetId() {
  return `asset-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function computeScrollPositions(scrollHeight: number, viewportHeight: number, overlapPx: number) {
  const maxScrollY = Math.max(0, scrollHeight - viewportHeight);
  if (maxScrollY === 0) {
    return [0];
  }

  const step = Math.max(1, viewportHeight - overlapPx);
  const positions: number[] = [];
  for (let y = 0; y < maxScrollY; y += step) {
    positions.push(y);
  }

  positions.push(maxScrollY);
  return Array.from(new Set(positions.map((value) => Math.max(0, Math.round(value)))));
}

export function computeSelectionScrollPositions(selectionRect: SelectionRect, metrics: PageMetrics, overlapPx: number) {
  const viewportHeight = Math.max(1, Math.round(metrics.viewportHeight));
  const maxScrollY = Math.max(0, Math.round(metrics.maxScrollY ?? Math.max(0, metrics.scrollHeight - viewportHeight)));
  const selectionTop = clampNumber(Math.round(selectionRect.top), 0, maxScrollY);
  const selectionBottom = clampNumber(Math.round(selectionRect.bottom), selectionTop, Math.max(selectionTop, Math.round(metrics.scrollHeight)));
  const startY = Math.min(selectionTop, maxScrollY);
  const endY = Math.min(Math.max(startY, selectionBottom - viewportHeight), maxScrollY);
  const step = Math.max(1, viewportHeight - overlapPx);
  const positions: number[] = [];

  for (let y = startY; y < endY; y += step) {
    positions.push(y);
  }

  positions.push(endY);
  return Array.from(new Set(positions.map((value) => Math.max(0, Math.round(value))))).sort((a, b) => a - b);
}

export function normalizeSelectionRect(response: any, metrics: PageMetrics): SelectionRect | null {
  const rawRect = response?.selectionRect ?? response?.rect ?? response?.selection ?? response?.bounds ?? response?.value ?? null;
  if (!rawRect || typeof rawRect !== "object") {
    return null;
  }

  const usesViewportCoordinates = isViewportCoordinateSpace(rawRect, response);
  const offsetX = usesViewportCoordinates ? Number(metrics.scrollX) || 0 : 0;
  const offsetY = usesViewportCoordinates ? Number(metrics.scrollY) || 0 : 0;
  const left = readRectValue(rawRect, ["pageX", "left", "x", "viewportX"], 0) + offsetX;
  const top = readRectValue(rawRect, ["pageY", "top", "y", "viewportY"], 0) + offsetY;
  const width = readRectDimension(rawRect, ["width", "w", "pageWidth", "viewportWidth"], 0, "right", "left");
  const height = readRectDimension(rawRect, ["height", "h", "pageHeight", "viewportHeight"], 0, "bottom", "top");

  if (!(width > 0 && height > 0)) {
    return null;
  }

  const scrollWidth = Number(metrics.scrollWidth) || width;
  const scrollHeight = Number(metrics.scrollHeight) || height;
  const normalizedLeft = clampNumber(left, 0, Math.max(0, scrollWidth));
  const normalizedTop = clampNumber(top, 0, Math.max(0, scrollHeight));
  const normalizedWidth = Math.max(1, Math.min(width, Math.max(1, scrollWidth - normalizedLeft)));
  const normalizedHeight = Math.max(1, Math.min(height, Math.max(1, scrollHeight - normalizedTop)));

  return {
    left: normalizedLeft,
    top: normalizedTop,
    width: normalizedWidth,
    height: normalizedHeight,
    right: normalizedLeft + normalizedWidth,
    bottom: normalizedTop + normalizedHeight,
  };
}

export function readRectValue(source: any, keys: string[], fallback: number) {
  for (const key of keys) {
    const value = Number(source?.[key]);
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return fallback;
}

export function readRectDimension(source: any, keys: string[], fallback: number, maxKey: string, minKey: string) {
  const directValue = readRectValue(source, keys, Number.NaN);
  if (Number.isFinite(directValue) && directValue > 0) {
    return directValue;
  }

  const maxValue = Number(source?.[maxKey]);
  const minValue = Number(source?.[minKey]);
  if (Number.isFinite(maxValue) && Number.isFinite(minValue)) {
    return Math.max(0, maxValue - minValue);
  }

  return fallback;
}

export function isViewportCoordinateSpace(rawRect: any, response: any) {
  const markers = [rawRect?.space, rawRect?.coordinateSpace, rawRect?.relativeTo, response?.space, response?.coordinateSpace]
    .map((value) => (typeof value === "string" ? value.toLowerCase() : ""))
    .filter(Boolean);

  return markers.some((marker) => marker.includes("viewport") || marker.includes("client"));
}

export function isMissingSelectionListenerError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /Receiving end does not exist|Could not establish connection|The message port closed|No listener/i.test(message);
}

export function getCapturePixelScale(captureRecord: any, firstFrameWidth: number) {
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

export function normalizeAssetId(value: unknown) {
  return value == null ? "" : value.toString().trim();
}

export function normalizeAssetIdList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => normalizeAssetId(item)).filter(Boolean);
}

export function readNumericValue(source: any, keys: string[], fallback: number) {
  for (const key of keys) {
    const value = source?.[key];
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return fallback;
}

export function scaleValue(value: unknown, scale: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return numeric * scale;
}

export function formatCaptureSource(captureRecord: any) {
  const title = captureRecord?.source?.title?.trim() ?? "";
  const url = captureRecord?.source?.url?.trim() ?? "";

  if (title && url) {
    return `${title} - ${safeHostname(url)}`;
  }

  if (title) {
    return title;
  }

  if (url) {
    return safeHostname(url) || url;
  }

  return "Waiting for capture";
}

export function safeHostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export function formatSegmentCount(captureRecord: any) {
  const candidates = [
    captureRecord?.tiles?.length,
    captureRecord?.frameAssetIds?.length,
    captureRecord?.metrics?.segmentCount,
    captureRecord?.metrics?.segments?.length,
    captureRecord?.segmentCount,
    captureRecord?.segments?.length,
    captureRecord?.segment?.length,
  ];

  for (const candidate of candidates) {
    const count = Number(candidate);
    if (Number.isFinite(count) && count > 0) {
      return count;
    }
  }

  return captureRecord?.resultAssetId || captureRecord?.asset ? 1 : "N/A";
}

export function getFrameCountLabel(captureRecord: any) {
  const tileCount = Array.isArray(captureRecord?.tiles) ? captureRecord.tiles.length : 0;
  if (tileCount > 0) {
    return tileCount === 1 ? "1 tile" : `${tileCount} tiles`;
  }

  const frameCount = Array.isArray(captureRecord?.frameAssetIds) ? captureRecord.frameAssetIds.length : 0;
  if (frameCount > 0) {
    return frameCount === 1 ? "1 frame" : `${frameCount} frames`;
  }

  return "";
}

export function buildCaption(captureId: string, captureRecord: any, imageSize: { width: number; height: number }, stitched: boolean) {
  const captureKind = stitched
    ? "stitched capture"
    : captureRecord?.kind
      ? `${captureRecord.kind} capture`
      : "capture";
  const source = formatCaptureSource(captureRecord);
  const frameLabel = getFrameCountLabel(captureRecord);
  const frameSuffix = frameLabel ? ` - ${frameLabel}` : "";

  return `${captureKind} ${captureId} - ${source}${frameSuffix} - ${imageSize.width} x ${imageSize.height}px`;
}

export function normalizeTiles(captureRecord: any) {
  const rawTiles = Array.isArray(captureRecord?.tiles) ? captureRecord.tiles : [];

  return rawTiles.map((tile: any, index: number) => ({
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

export function resolveTileFrameAssetId(tile: any, index: number, frameAssetIds: string[]) {
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

export function getFrameAssetIds(captureRecord: any, tiles: any[] = []) {
  const directIds = normalizeAssetIdList(captureRecord?.frameAssetIds);
  if (directIds.length) {
    return directIds;
  }

  const tileIds = tiles.map((tile, index) => resolveTileFrameAssetId(tile, index, [])).filter(Boolean);
  if (tileIds.length) {
    return [...new Set(tileIds)];
  }

  return [];
}

export function isPrimarySelectionSize(width: number, height: number) {
  return width >= MIN_SELECTION_SIZE && height >= MIN_SELECTION_SIZE;
}
