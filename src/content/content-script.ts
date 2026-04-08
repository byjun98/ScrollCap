import {
  AUTO_SCROLL_MARGIN,
  AUTO_SCROLL_MAX_SPEED,
  CAPTURE_HIDDEN_ATTR,
  CAPTURE_UI_ATTR,
  MIN_SELECTION_SIZE,
} from "../shared/constants";
import type { PageMetrics, SelectionResult } from "../shared/capture-types";

type CapturePreparation = {
  hiddenEntries: CaptureStyleEntry[];
  pageStyleEntries: CaptureStyleEntry[];
};

type CaptureStyleEntry = {
  element: HTMLElement;
  hadStyleAttribute: boolean;
  styleAttribute: string | null;
};

type SelectionUi = {
  host: HTMLDivElement;
  shadowRoot: ShadowRoot;
  overlay: HTMLDivElement;
  backdrop: HTMLDivElement;
  selectionRect: HTMLDivElement;
  selectionLabel: HTMLDivElement;
  selectionHint: HTMLDivElement;
  selectionSize: HTMLDivElement;
};

type SelectionCaptureResponse = {
  canceled: boolean;
  reason?: string;
  selection?: SelectionResult | null;
  viewportMetrics?: PageMetrics | null;
};

type SelectionSession = {
  active: boolean;
  host: HTMLDivElement;
  shadowRoot: ShadowRoot;
  overlay: HTMLDivElement;
  backdrop: HTMLDivElement;
  selectionRect: HTMLDivElement;
  selectionLabel: HTMLDivElement;
  selectionHint: HTMLDivElement;
  selectionSize: HTMLDivElement;
  pointerId: number | null;
  startClientX: number;
  startClientY: number;
  lastClientX: number;
  lastClientY: number;
  startDocX: number;
  startDocY: number;
  currentDocX: number;
  currentDocY: number;
  startScrollX: number;
  startScrollY: number;
  viewportMetrics: PageMetrics | null;
  autoScrollFrame: number;
  resolve: ((result: any) => void) | null;
  cleanupListeners?: (() => void) | null;
  suppressForCapture: boolean;
  selectionUiEntry?: CaptureStyleEntry | null;
};

declare global {
  interface Window {
    __scrollCaptureContentLoaded?: boolean;
  }
}

const win = window as Window;

(() => {
  if (win.__scrollCaptureContentLoaded) {
    return;
  }

  win.__scrollCaptureContentLoaded = true;

  let capturePreparation: CapturePreparation | null = null;
  let selectionSession: SelectionSession | null = null;

  chrome.runtime.onMessage.addListener((message: any, _sender: any, sendResponse: any) => {
    if (message?.type === "popup/ping") {
      sendResponse({ ok: true });
      return true;
    }

    if (message?.type === "content/scrollToPosition") {
      void scrollAndSettle(message.x ?? window.scrollX, message.y ?? 0).then((position) => {
        sendResponse({
          ok: true,
          index: message.index ?? null,
          ...position,
          stable: true,
        });
      });
      return true;
    }

    if (message?.type === "content/restoreScrollPosition") {
      void scrollAndSettle(message.x ?? 0, message.y ?? 0).then((position) => {
        sendResponse({
          ok: true,
          ...position,
        });
      });
      return true;
    }

    if (message?.type === "content/prepareForCapture") {
      void prepareForCapture(message?.options ?? {}).then((result) => {
        sendResponse({
          ok: true,
          ...result,
        });
      });
      return true;
    }

    if (message?.type === "content/cleanupAfterCapture") {
      cleanupAfterCapture();
      sendResponse({
        ok: true,
      });
      return true;
    }

    if (message?.type === "content/startSelectionCapture") {
      void startSelectionCapture()
        .then((result: SelectionCaptureResponse) => {
          sendResponse({
            ok: true,
            ...result,
          });
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return true;
    }

    if (message?.type === "content/cancelSelectionCapture") {
      sendResponse({
        ok: true,
        ...cancelSelectionCapture({ reason: "message" }),
      });
      return true;
    }

    if (message?.type === "content/getSelectionCaptureState") {
      sendResponse({
        ok: true,
        state: getSelectionCaptureState(),
      });
      return true;
    }

    if (message?.type !== "content/getPageMetrics") {
      return false;
    }

    sendResponse({
      ok: true,
      metrics: collectPageMetrics(),
    });
    return true;
  });

  function collectPageMetrics(): PageMetrics {
    const root = document.scrollingElement || document.documentElement;
    const body = document.body;

    const scrollWidth = Math.max(
      root?.scrollWidth || 0,
      body?.scrollWidth || 0,
      root?.clientWidth || 0,
      window.innerWidth
    );

    const scrollHeight = Math.max(
      root?.scrollHeight || 0,
      body?.scrollHeight || 0,
      root?.clientHeight || 0,
      window.innerHeight
    );

    return {
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollWidth,
      scrollHeight,
      maxScrollY: Math.max(0, scrollHeight - window.innerHeight),
      devicePixelRatio: window.devicePixelRatio || 1,
    };
  }

  function scrollAndSettle(x: number, y: number) {
    return new Promise<{ actualX: number; actualY: number }>((resolve) => {
      window.scrollTo(x, y);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.setTimeout(() => {
            resolve({
              actualX: window.scrollX,
              actualY: window.scrollY,
            });
          }, 120);
        });
      });
    });
  }

  async function prepareForCapture(options: { suppressFixedElements?: boolean } = {}) {
    if (capturePreparation) {
      return {
        hiddenCount: capturePreparation.hiddenEntries.length,
      };
    }

    const hiddenEntries: CaptureStyleEntry[] = [];
    if (options.suppressFixedElements !== false) {
      for (const element of collectStickyAndFixedCandidates()) {
        hiddenEntries.push(hideElementForCapture(element));
      }
    }

    const pageStyleEntries = [document.documentElement, document.body]
      .filter(Boolean)
      .map(disableScrollEffectsForCapture);

    const selectionUiEntry = hideSelectionUiForCapture();
    if (selectionUiEntry) {
      hiddenEntries.push(selectionUiEntry);
    }

    capturePreparation = {
      hiddenEntries,
      pageStyleEntries,
    };

    return {
      hiddenCount: hiddenEntries.length,
    };
  }

  function cleanupAfterCapture() {
    if (!capturePreparation) {
      return;
    }

    for (const entry of capturePreparation.hiddenEntries) {
      restoreInlineStyle(entry);
      entry.element.removeAttribute(CAPTURE_HIDDEN_ATTR);
    }

    for (const entry of capturePreparation.pageStyleEntries) {
      restoreInlineStyle(entry);
    }

    capturePreparation = null;
  }

  function collectStickyAndFixedCandidates() {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const result: HTMLElement[] = [];

    for (const element of document.body?.querySelectorAll("*") ?? []) {
      if (isScrollCaptureUiElement(element)) {
        continue;
      }

      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
        continue;
      }

      const position = style.position;
      if (position !== "fixed" && position !== "sticky") {
        continue;
      }

      const rect = element.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) {
        continue;
      }

      if (rect.bottom <= 0 || rect.top >= viewportHeight || rect.right <= 0 || rect.left >= viewportWidth) {
        continue;
      }

      if (position === "sticky" && !isActivelyStuck(rect, style, viewportWidth, viewportHeight)) {
        continue;
      }

      if (rect.width >= viewportWidth * 0.96 && rect.height >= viewportHeight * 0.96) {
        continue;
      }

      result.push(element as HTMLElement);
    }

    return result;
  }

  function isActivelyStuck(rect: DOMRect, style: CSSStyleDeclaration, viewportWidth: number, viewportHeight: number) {
    const top = readCssInset(style.top);
    const bottom = readCssInset(style.bottom);
    const left = readCssInset(style.left);
    const right = readCssInset(style.right);

    return (
      (top !== null && Math.abs(rect.top - top) <= 4) ||
      (bottom !== null && Math.abs(viewportHeight - rect.bottom - bottom) <= 4) ||
      (left !== null && Math.abs(rect.left - left) <= 4) ||
      (right !== null && Math.abs(viewportWidth - rect.right - right) <= 4) ||
      rect.top <= 2 ||
      rect.bottom >= viewportHeight - 2
    );
  }

  function hideElementForCapture(element: HTMLElement) {
    const entry = captureInlineStyle(element);
    element.setAttribute(CAPTURE_HIDDEN_ATTR, "true");
    element.style.setProperty("visibility", "hidden", "important");
    element.style.setProperty("pointer-events", "none", "important");
    element.style.setProperty("animation-play-state", "paused", "important");
    return entry;
  }

  function disableScrollEffectsForCapture(element: Element) {
    const htmlElement = element as HTMLElement;
    const entry = captureInlineStyle(htmlElement);
    htmlElement.style.setProperty("scroll-behavior", "auto", "important");
    htmlElement.style.setProperty("scroll-snap-type", "none", "important");
    return entry;
  }

  function captureInlineStyle(element: HTMLElement): CaptureStyleEntry {
    return {
      element,
      hadStyleAttribute: element.hasAttribute("style"),
      styleAttribute: element.getAttribute("style"),
    };
  }

  function restoreInlineStyle(entry: CaptureStyleEntry) {
    if (entry.hadStyleAttribute) {
      entry.element.setAttribute("style", entry.styleAttribute ?? "");
      return;
    }

    entry.element.removeAttribute("style");
  }

  function readCssInset(value: string) {
    const numeric = Number.parseFloat(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  async function startSelectionCapture(): Promise<SelectionCaptureResponse> {
    if (!document.documentElement) {
      throw new Error("이 페이지에서는 선택 캡처를 시작할 수 없습니다.");
    }

    if (selectionSession?.active) {
      cancelSelectionCapture({ reason: "restart" });
    }

    const ui = ensureSelectionUi();
    const selectionRect = ui.selectionRect;
    const selectionLabel = ui.selectionLabel;
    const selectionHint = ui.selectionHint;

    selectionSession = {
      active: true,
      host: ui.host,
      shadowRoot: ui.shadowRoot,
      overlay: ui.overlay,
      backdrop: ui.backdrop,
      selectionRect,
      selectionLabel,
      selectionHint,
      selectionSize: ui.selectionSize,
      pointerId: null,
      startClientX: 0,
      startClientY: 0,
      lastClientX: 0,
      lastClientY: 0,
      startDocX: 0,
      startDocY: 0,
      currentDocX: 0,
      currentDocY: 0,
      startScrollX: 0,
      startScrollY: 0,
      viewportMetrics: null,
      autoScrollFrame: 0,
      resolve: null,
      suppressForCapture: false,
    };

    selectionSession.viewportMetrics = collectPageMetrics();

    updateSelectionUi({
      active: false,
      rect: null,
      label: "드래그해서 영역 선택",
      hint: "마우스를 놓으면 확정됩니다. Esc로 취소할 수 있습니다.",
    });

    const result = await new Promise<SelectionCaptureResponse>((resolve) => {
      if (!selectionSession) {
        resolve({ canceled: true, reason: "inactive" });
        return;
      }

      selectionSession.resolve = resolve;

      const onPointerDown = (event: PointerEvent) => {
        if (!selectionSession?.active || event.button !== 0) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        selectionSession.pointerId = event.pointerId;
        selectionSession.startClientX = event.clientX;
        selectionSession.startClientY = event.clientY;
        selectionSession.lastClientX = event.clientX;
        selectionSession.lastClientY = event.clientY;
        selectionSession.startScrollX = window.scrollX;
        selectionSession.startScrollY = window.scrollY;
        selectionSession.startDocX = window.scrollX + event.clientX;
        selectionSession.startDocY = window.scrollY + event.clientY;
        selectionSession.currentDocX = selectionSession.startDocX;
        selectionSession.currentDocY = selectionSession.startDocY;
        selectionSession.viewportMetrics = collectPageMetrics();

        try {
          ui.overlay.setPointerCapture(event.pointerId);
        } catch {
          // Pointer capture is best-effort.
        }

        updateSelectionFromPointer(event.clientX, event.clientY);
        startAutoScrollLoop();
      };

      const onPointerMove = (event: PointerEvent) => {
        if (!selectionSession?.active || selectionSession.pointerId !== event.pointerId) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        selectionSession.lastClientX = event.clientX;
        selectionSession.lastClientY = event.clientY;
        updateSelectionFromPointer(event.clientX, event.clientY);
      };

      const finalizeWithPointer = (event: PointerEvent) => {
        if (!selectionSession?.active || selectionSession.pointerId !== event.pointerId) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        endAutoScrollLoop();

        const selection = buildSelectionResult();
        if (selection) {
          finishSelection({
            canceled: false,
            selection,
          });
        } else {
          finishSelection({
            canceled: true,
            reason: "empty-selection",
          });
        }
      };

      const onKeyDown = (event: KeyboardEvent) => {
        if (!selectionSession?.active || event.key !== "Escape") {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        cancelSelectionCapture({ reason: "escape" });
      };

      const onScroll = () => {
        if (!selectionSession?.active) {
          return;
        }

        selectionSession.currentDocX = window.scrollX + selectionSession.lastClientX;
        selectionSession.currentDocY = window.scrollY + selectionSession.lastClientY;
        renderSelectionBox();
      };

      const cleanupListeners = () => {
        ui.overlay.removeEventListener("pointerdown", onPointerDown, true);
        ui.overlay.removeEventListener("pointermove", onPointerMove, true);
        ui.overlay.removeEventListener("pointerup", finalizeWithPointer, true);
        ui.overlay.removeEventListener("pointercancel", finalizeWithPointer, true);
        window.removeEventListener("keydown", onKeyDown, true);
        window.removeEventListener("scroll", onScroll, true);
      };

      selectionSession.cleanupListeners = cleanupListeners;

      ui.overlay.addEventListener("pointerdown", onPointerDown, true);
      ui.overlay.addEventListener("pointermove", onPointerMove, true);
      ui.overlay.addEventListener("pointerup", finalizeWithPointer, true);
      ui.overlay.addEventListener("pointercancel", finalizeWithPointer, true);
      window.addEventListener("keydown", onKeyDown, true);
      window.addEventListener("scroll", onScroll, true);
    });

    return result;
  }

  function cancelSelectionCapture(details: { reason?: string } = {}): SelectionCaptureResponse {
    if (!selectionSession?.active) {
      return {
        canceled: true,
        reason: details.reason ?? "inactive",
      };
    }

    endAutoScrollLoop();

    const result = {
      canceled: true,
      reason: details.reason ?? "user-cancel",
    };

    finishSelection(result);
    return result;
  }

  function finishSelection(result: SelectionCaptureResponse) {
    if (!selectionSession) {
      return;
    }

    const { resolve, cleanupListeners, host, suppressForCapture } = selectionSession;

    endAutoScrollLoop();
    selectionSession.active = false;
    if (typeof cleanupListeners === "function") {
      cleanupListeners();
    }

    restoreSelectionUiVisibility();

    if (host?.isConnected) {
      host.remove();
    }

    selectionSession = null;

    if (typeof resolve === "function") {
      resolve(result);
    }

    if (suppressForCapture) {
      // If a capture was in progress, the caller will later restore page state.
    }
  }

  function getSelectionCaptureState() {
    if (!selectionSession?.active) {
      return {
        active: false,
      };
    }

    const selection = buildSelectionResult();
    return {
      active: true,
      selection,
      viewportMetrics: selectionSession.viewportMetrics,
    };
  }

  function buildSelectionResult(): SelectionResult | null {
    if (!selectionSession) {
      return null;
    }

    const startDocX = selectionSession.startDocX;
    const startDocY = selectionSession.startDocY;
    const endDocX = window.scrollX + selectionSession.lastClientX;
    const endDocY = window.scrollY + selectionSession.lastClientY;

    const x = Math.min(startDocX, endDocX);
    const y = Math.min(startDocY, endDocY);
    const width = Math.abs(endDocX - startDocX);
    const height = Math.abs(endDocY - startDocY);

    if (width < MIN_SELECTION_SIZE || height < MIN_SELECTION_SIZE) {
      return null;
    }

    return {
      x,
      y,
      width,
      height,
      left: x,
      top: y,
      right: x + width,
      bottom: y + height,
      startScrollX: selectionSession.startScrollX,
      startScrollY: selectionSession.startScrollY,
      endScrollX: window.scrollX,
      endScrollY: window.scrollY,
      viewportMetrics: selectionSession.viewportMetrics,
      pointer: {
        startX: selectionSession.startClientX,
        startY: selectionSession.startClientY,
        endX: selectionSession.lastClientX,
        endY: selectionSession.lastClientY,
      },
    };
  }

  function ensureSelectionUi(): SelectionUi {
    if (selectionSession?.host?.isConnected) {
      return {
        host: selectionSession.host,
        shadowRoot: selectionSession.shadowRoot,
        overlay: selectionSession.overlay,
        backdrop: selectionSession.backdrop,
        selectionRect: selectionSession.selectionRect,
        selectionLabel: selectionSession.selectionLabel,
        selectionHint: selectionSession.selectionHint,
        selectionSize: selectionSession.selectionSize,
      };
    }

    const host = document.createElement("div");
    host.setAttribute(CAPTURE_UI_ATTR, "selection-host");
    host.style.cssText = [
      "position: fixed",
      "inset: 0",
      "z-index: 2147483647",
      "pointer-events: auto",
      "cursor: crosshair",
      "user-select: none",
      "-webkit-user-select: none",
      "touch-action: none",
      "contain: layout style paint",
    ].join(";");

    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <style>
        :host {
          all: initial;
        }
        .overlay {
          position: fixed;
          inset: 0;
          width: 100vw;
          height: 100vh;
          pointer-events: auto;
          cursor: crosshair;
          user-select: none;
          -webkit-user-select: none;
          touch-action: none;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .backdrop {
          position: absolute;
          inset: 0;
          background: rgba(2, 6, 23, 0.08);
          backdrop-filter: none;
        }
        .selection-rect {
          position: absolute;
          border: 1px solid rgba(125, 211, 252, 0.95);
          background: rgba(56, 189, 248, 0.12);
          box-shadow: 0 0 0 1px rgba(8, 145, 178, 0.35), 0 10px 30px rgba(15, 23, 42, 0.18);
          border-radius: 6px;
          display: none;
          min-width: 1px;
          min-height: 1px;
        }
        .selection-rect::before,
        .selection-rect::after {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: inherit;
          pointer-events: none;
        }
        .selection-rect::before {
          border: 1px solid rgba(255, 255, 255, 0.28);
          inset: 2px;
        }
        .selection-readout {
          position: absolute;
          left: 18px;
          top: 18px;
          max-width: min(420px, calc(100vw - 36px));
          padding: 12px 14px;
          border-radius: 14px;
          background: rgba(15, 23, 42, 0.9);
          border: 1px solid rgba(148, 163, 184, 0.2);
          color: #e5eefc;
          box-shadow: 0 20px 50px rgba(2, 6, 23, 0.26);
          display: grid;
          gap: 6px;
        }
        .selection-title {
          font-size: 0.85rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #7dd3fc;
        }
        .selection-label {
          font-size: 0.95rem;
          font-weight: 600;
        }
        .selection-hint {
          font-size: 0.8rem;
          line-height: 1.4;
          color: #9eb1d1;
        }
        .selection-size {
          font-size: 0.78rem;
          color: #cbd5e1;
          font-variant-numeric: tabular-nums;
        }
      </style>
      <div class="overlay" part="overlay">
        <div class="backdrop"></div>
        <div class="selection-rect" data-role="selection-rect"></div>
        <div class="selection-readout" data-role="readout">
          <div class="selection-title">선택 영역 캡처</div>
          <div class="selection-label" data-role="selection-label">드래그해서 영역 선택</div>
          <div class="selection-size" data-role="selection-size">0 x 0</div>
          <div class="selection-hint" data-role="selection-hint">마우스를 놓으면 확정됩니다. Esc로 취소할 수 있습니다.</div>
        </div>
      </div>
    `;

    const overlay = shadowRoot.querySelector(".overlay") as HTMLDivElement;
    const selectionRect = shadowRoot.querySelector('[data-role="selection-rect"]') as HTMLDivElement;
    const selectionLabel = shadowRoot.querySelector('[data-role="selection-label"]') as HTMLDivElement;
    const selectionHint = shadowRoot.querySelector('[data-role="selection-hint"]') as HTMLDivElement;
    const selectionSize = shadowRoot.querySelector('[data-role="selection-size"]') as HTMLDivElement;
    const backdrop = shadowRoot.querySelector(".backdrop") as HTMLDivElement;

    if (!document.documentElement.contains(host)) {
      document.documentElement.appendChild(host);
    }

    selectionSession = selectionSession || ({} as SelectionSession);
    selectionSession.host = host;
    selectionSession.shadowRoot = shadowRoot;
    selectionSession.overlay = overlay;
    selectionSession.backdrop = backdrop;
    selectionSession.selectionRect = selectionRect;
    selectionSession.selectionLabel = selectionLabel;
    selectionSession.selectionHint = selectionHint;
    selectionSession.selectionSize = selectionSize;

    return {
      host,
      shadowRoot,
      overlay,
      backdrop,
      selectionRect,
      selectionLabel,
      selectionHint,
      selectionSize,
    };
  }

  function updateSelectionFromPointer(clientX: number, clientY: number) {
    if (!selectionSession) {
      return;
    }

    selectionSession.lastClientX = clientX;
    selectionSession.lastClientY = clientY;
    selectionSession.currentDocX = window.scrollX + clientX;
    selectionSession.currentDocY = window.scrollY + clientY;
    renderSelectionBox();
  }

  function renderSelectionBox() {
    if (!selectionSession?.selectionRect) {
      return;
    }

    const { startDocX, startDocY, currentDocX, currentDocY } = selectionSession;
    const currentScrollX = window.scrollX;
    const currentScrollY = window.scrollY;

    const left = Math.min(startDocX, currentDocX) - currentScrollX;
    const top = Math.min(startDocY, currentDocY) - currentScrollY;
    const width = Math.max(0, Math.abs(currentDocX - startDocX));
    const height = Math.max(0, Math.abs(currentDocY - startDocY));

    selectionSession.selectionRect.style.display = "block";
    selectionSession.selectionRect.style.left = `${left}px`;
    selectionSession.selectionRect.style.top = `${top}px`;
    selectionSession.selectionRect.style.width = `${width}px`;
    selectionSession.selectionRect.style.height = `${height}px`;

    if (selectionSession.selectionSize) {
      selectionSession.selectionSize.textContent = `${Math.round(width)} x ${Math.round(height)} px`;
    }

    if (selectionSession.selectionLabel) {
      const rect = buildSelectionResult();
      selectionSession.selectionLabel.textContent = rect
        ? `선택 시작점 ${Math.round(rect.x)}, ${Math.round(rect.y)}`
        : "드래그해서 영역 선택";
    }
  }

  function updateSelectionUi({ active, rect, label, hint }: { active: boolean; rect: { left: number; top: number; width: number; height: number } | null; label: string; hint: string }) {
    if (!selectionSession?.selectionRect) {
      return;
    }

    selectionSession.selectionRect.style.display = active ? "block" : "none";

    if (rect) {
      selectionSession.selectionRect.style.left = `${rect.left}px`;
      selectionSession.selectionRect.style.top = `${rect.top}px`;
      selectionSession.selectionRect.style.width = `${rect.width}px`;
      selectionSession.selectionRect.style.height = `${rect.height}px`;
    }

    if (selectionSession.selectionLabel && typeof label === "string") {
      selectionSession.selectionLabel.textContent = label;
    }

    if (selectionSession.selectionHint && typeof hint === "string") {
      selectionSession.selectionHint.textContent = hint;
    }
  }

  function hideSelectionUiForCapture() {
    if (!selectionSession?.host?.isConnected) {
      return null;
    }

    const entry = captureInlineStyle(selectionSession.host);
    selectionSession.host.setAttribute(CAPTURE_HIDDEN_ATTR, "true");
    selectionSession.host.style.setProperty("display", "none", "important");
    selectionSession.selectionUiEntry = entry;
    selectionSession.suppressForCapture = true;
    return entry;
  }

  function restoreSelectionUiVisibility() {
    if (!selectionSession?.selectionUiEntry) {
      return;
    }

    restoreInlineStyle(selectionSession.selectionUiEntry);
    selectionSession.host?.removeAttribute(CAPTURE_HIDDEN_ATTR);
    selectionSession.selectionUiEntry = null;
    selectionSession.suppressForCapture = false;
  }

  function isScrollCaptureUiElement(element: Element) {
    return Boolean((element as Element | null)?.closest?.(`[${CAPTURE_UI_ATTR}]`));
  }

  function startAutoScrollLoop() {
    const session = selectionSession;
    if (!session || session.autoScrollFrame) {
      return;
    }

    const step = () => {
      const currentSession = selectionSession;
      if (!currentSession?.active) {
        if (currentSession) {
          currentSession.autoScrollFrame = 0;
        }
        return;
      }

      const clientY = currentSession.lastClientY;
      const viewportHeight = window.innerHeight;

      let deltaY = 0;
      if (clientY < AUTO_SCROLL_MARGIN) {
        const ratio = (AUTO_SCROLL_MARGIN - clientY) / AUTO_SCROLL_MARGIN;
        deltaY = -Math.ceil(AUTO_SCROLL_MAX_SPEED * Math.min(1, ratio));
      } else if (clientY > viewportHeight - AUTO_SCROLL_MARGIN) {
        const ratio = (clientY - (viewportHeight - AUTO_SCROLL_MARGIN)) / AUTO_SCROLL_MARGIN;
        deltaY = Math.ceil(AUTO_SCROLL_MAX_SPEED * Math.min(1, ratio));
      }

      if (deltaY !== 0) {
        window.scrollBy(0, deltaY);
        currentSession.currentDocX = window.scrollX + currentSession.lastClientX;
        currentSession.currentDocY = window.scrollY + currentSession.lastClientY;
        renderSelectionBox();
      }

      currentSession.autoScrollFrame = window.requestAnimationFrame(step);
    };

    session.autoScrollFrame = window.requestAnimationFrame(step);
  }

  function endAutoScrollLoop() {
    if (!selectionSession?.autoScrollFrame) {
      return;
    }

    window.cancelAnimationFrame(selectionSession.autoScrollFrame);
    selectionSession.autoScrollFrame = 0;
  }
})();

export {};
