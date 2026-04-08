export type CaptureKind = "visible-tab" | "scroll-tab" | "selection-tab";

export interface PageMetrics {
  scrollX: number;
  scrollY: number;
  viewportWidth: number;
  viewportHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  maxScrollY: number;
  devicePixelRatio: number;
}

export interface SelectionRect {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

export interface SelectionResult extends SelectionRect {
  x: number;
  y: number;
  startScrollX: number;
  startScrollY: number;
  endScrollX: number;
  endScrollY: number;
  viewportMetrics?: PageMetrics | null;
  pointer?: {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  };
}

export interface CaptureSource {
  tabId: number;
  windowId: number;
  title: string;
  url: string;
}

export interface CaptureAssetRecord {
  assetId: string;
  role: string;
  state: string;
  storage: string;
  storageKey: string;
  mime: string;
  width: number | null;
  height: number | null;
  byteLength: number;
  derivedFrom: string[];
  createdAt: string;
}

export interface CaptureRecord {
  id: string;
  kind: CaptureKind;
  status: string;
  createdAt: string;
  updatedAt: string;
  source: CaptureSource;
  pending?: {
    step: string | null;
    current: number;
    total: number;
    unit: string;
    updatedAt: string;
    error: null | {
      code?: string;
      message: string;
      retryable?: boolean;
    };
  };
  metrics?: Record<string, unknown> | null;
  page?: Record<string, unknown> | null;
  selection?: SelectionRect | null;
  asset?: string | null;
  frameAssetIds?: string[];
  resultAssetId?: string | null;
  assetsById?: Record<string, CaptureAssetRecord | Record<string, unknown>>;
  tiles?: Array<Record<string, unknown>>;
  error?: null | {
    message: string;
  };
}
