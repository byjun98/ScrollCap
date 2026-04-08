import { defineConfig, type Plugin } from "vite";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));
const resolveRoot = (...segments: string[]) => resolve(rootDir, ...segments);

function emitManifestPlugin(): Plugin {
  const manifestPath = resolveRoot("manifest.json");

  return {
    name: "emit-extension-manifest",
    generateBundle() {
      const manifestSource = readFileSync(manifestPath, "utf8");
      this.emitFile({
        type: "asset",
        fileName: "manifest.json",
        source: manifestSource,
      });
    },
  };
}

export default defineConfig({
  base: "./",
  publicDir: false,
  plugins: [emitManifestPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    manifest: false,
    minify: false,
    cssMinify: false,
    reportCompressedSize: false,
    rollupOptions: {
      input: {
        popup: resolveRoot("popup.html"),
        editor: resolveRoot("editor.html"),
        "service-worker": resolveRoot("src", "background", "service-worker.ts"),
        "content-script": resolveRoot("src", "content", "content-script.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
