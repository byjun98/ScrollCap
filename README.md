# ScrollCap

Chrome MV3 prototype for:

- visible-area capture
- full-page vertical scroll capture
- editor preview and stitching
- crop selection
- PNG / JPEG export
- settings for file naming, auto-save subfolders, and large export splitting
- keyboard shortcuts for visible capture, full-page capture, selection capture, and popup open

## Current status

Implemented stages:

- Stage 1: extension scaffold, popup, service worker, editor shell
- Stage 2: visible capture and editor handoff
- Stage 3: full-page auto-scroll capture with editor-side stitching
- Stage 4: crop mode and PNG/JPEG export
- Stage 5: basic hardening and usage docs
- Stage 6: image asset storage moved to IndexedDB
- Stage 7: heuristic sticky/fixed suppression and crop autoscroll improvements
- Stage 8: applied crop preview plus crop undo/redo history
- Stage 9: selection capture with on-page drag selection and autoscroll

Refactor status:

- Phase 1 completed: Vite + TypeScript build pipeline added
- `popup.html` and `editor.html` are Vite HTML inputs, while `src/background/*`, `src/content/*`, and `src/shared/*` stay in the TypeScript build graph
- `src/popup/*` and `src/editor/*` are now the active UI entrypoints behind those HTML shells
- Runtime entrypoints now come from `src/**`; the old root JavaScript runtime files have been removed
- React/Tailwind/shadcn are intentionally deferred until after the capture engine refactor is fully settled

## Files

- `manifest.json`: MV3 manifest source copied into `dist`
- `scripts/build-extension.mjs`: `dist` 산출물을 만드는 esbuild 기반 빌드 스크립트
- `src/background/service-worker.ts`: capture orchestration source
- `src/content/content-script.ts`: content-script entry source
- `src/editor/runtime.ts`: editor runtime source
- `src/editor/storage.ts`: editor-side asset loading helpers
- `src/shared/*`: shared capture types, storage, and utility helpers
- `src/popup/main.ts`: popup entry source
- `src/editor/main.ts`: editor entry source
- `popup.html`, `popup.css`: Vite-processed popup shell assets
- `editor.html`, `editor.css`: Vite-processed editor shell assets
- `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`: 리팩토링 시점의 Vite + TypeScript 설정 파일

## Build

1. Install dependencies with `npm install`
2. Optionally verify TypeScript wiring with `npm run typecheck`
3. Build the extension with `npm run build`
4. Load the generated `dist` folder as an unpacked extension in Chrome

The build keeps `popup.html`, `editor.html`, `service-worker.js`, `content-script.js`, and `manifest.json` in `dist` with stable names. The current default build path uses `scripts/build-extension.mjs` with esbuild so the unpacked extension can be reloaded from `dist` without depending on Vite's HTML rewriting. Load the built `dist` directory, not the repository root.

If PowerShell blocks `npm` scripts on Windows, use `npm.cmd install`, `npm.cmd run typecheck`, and `npm.cmd run build` instead.

## Load in Chrome

1. Open `chrome://extensions`
2. Turn on Developer mode
3. Click `Load unpacked`
4. Select the generated `dist` folder in this workspace

## How to test

### Visible capture

1. Open any normal web page
2. Click the extension icon
3. Click the visible-area capture button
4. Confirm the editor tab opens with the captured image

### Full-page capture

1. Open a long page with vertical scrolling
2. Click the extension icon
3. Click the full-page capture button
4. Wait for the editor tab to open
5. Confirm the stitched result appears

### Selection capture

1. Open a page with vertical scrolling
2. Click the extension icon
3. Click `Selection Capture`
4. On the page, drag to define the capture area
5. Keep dragging near the top or bottom edge if you want the page to autoscroll while the selection grows
6. Release to confirm the selection and wait for the editor tab to open

### Crop and export

1. In the editor, click `Crop`
2. Drag on the image to create a crop box
3. Click `Done Crop` to lock the crop and preview the cropped result
4. Use `Undo`, `Redo`, `Ctrl+Z`, or `Ctrl+Y` if you want to step backward or forward through crop changes
5. Click `Export PNG` or `Export JPEG`
6. Confirm Chrome shows a save dialog and starts the download

### Settings

1. Open the popup and click `설정`
2. Adjust file naming format, download subfolder, fixed/sticky suppression, large export splitting, and shortcuts
3. Save the settings and test with a new capture

### Shortcuts

- `Ctrl+Shift+7`: visible capture
- `Ctrl+Shift+8`: full-page capture
- `Ctrl+Shift+9`: selection capture
- `Ctrl+Shift+0`: open popup
- You can customize them in `chrome://extensions/shortcuts`

## Known limitations

- Full-page capture currently supports vertical top-level scrolling only
- Selection capture currently supports vertical top-level scrolling only
- Cross-origin iframes and nested scroll containers are not handled
- Sticky/fixed suppression is heuristic-based, so some sites may still need manual cleanup
- Download paths can only target subfolders under Chrome's downloads directory
- Capture metadata is stored in `chrome.storage.local`, while image bytes are stored in IndexedDB
- Existing older captures saved in `chrome.storage.local` still load through a fallback path
- Restricted pages such as internal browser pages may allow visible capture but block full-page injection

## Best next upgrades

- Automatically migrate older legacy assets from `chrome.storage.local` into IndexedDB
- Improve fixed/sticky suppression heuristics during full-page capture
- Add resize handles and keyboard nudging for crop
- Add PDF export
- Add selection capture mode
- Add capture history and draft recovery

## Notes

- The extension currently prefers least-privilege permissions:
  `activeTab`, `scripting`, `storage`, `downloads`
- Full-page capture is intentionally implemented as a prototype pipeline first, then hardened later
