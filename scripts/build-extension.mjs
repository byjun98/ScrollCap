import { build } from "esbuild";
import { mkdir, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(rootDir, "dist");

const entries = [
  {
    entry: resolve(rootDir, "src", "popup", "main.ts"),
    outfile: resolve(distDir, "popup.js"),
  },
  {
    entry: resolve(rootDir, "src", "settings", "main.ts"),
    outfile: resolve(distDir, "settings.js"),
  },
  {
    entry: resolve(rootDir, "src", "editor", "main.ts"),
    outfile: resolve(distDir, "editor.js"),
  },
  {
    entry: resolve(rootDir, "src", "background", "service-worker.ts"),
    outfile: resolve(distDir, "service-worker.js"),
  },
  {
    entry: resolve(rootDir, "src", "content", "content-script.ts"),
    outfile: resolve(distDir, "content-script.js"),
  },
];

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

for (const bundle of entries) {
  await build({
    entryPoints: [bundle.entry],
    outfile: bundle.outfile,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["chrome120"],
    charset: "utf8",
    legalComments: "none",
    sourcemap: false,
    minify: false,
    logLevel: "info",
  });
}

await Promise.all([
  copyFile(resolve(rootDir, "manifest.json"), resolve(distDir, "manifest.json")),
  copyFile(resolve(rootDir, "popup.css"), resolve(distDir, "popup.css")),
  copyFile(resolve(rootDir, "settings.css"), resolve(distDir, "settings.css")),
  copyFile(resolve(rootDir, "editor.css"), resolve(distDir, "editor.css")),
]);

await Promise.all([
  writeBuiltHtml("popup.html", /<script type="module" src="\/src\/popup\/main\.ts"><\/script>/, '<script type="module" src="./popup.js"></script>'),
  writeBuiltHtml("settings.html", /<script type="module" src="\/src\/settings\/main\.ts"><\/script>/, '<script type="module" src="./settings.js"></script>'),
  writeBuiltHtml("editor.html", /<script type="module" src="\/src\/editor\/main\.ts"><\/script>/, '<script type="module" src="./editor.js"></script>'),
]);

async function writeBuiltHtml(filename, scriptPattern, replacement) {
  const sourcePath = resolve(rootDir, filename);
  const outputPath = resolve(distDir, filename);
  const source = await readFile(sourcePath, "utf8");
  const rewritten = source.replace(scriptPattern, replacement);
  await writeFile(outputPath, rewritten, "utf8");
}
