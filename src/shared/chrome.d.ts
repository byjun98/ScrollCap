declare global {
  interface Window {
    __scrollCaptureContentLoaded?: boolean;
    editorHooks?: {
      setSummary(nextState?: {
        captureSource?: string;
        segments?: number | string;
        canvasSize?: string;
        status?: string;
        empty?: boolean;
      }): void;
      setStatus(message: string): void;
      setEmptyMode(isEmpty: boolean): void;
    };
  }
}

export {};
