#!/usr/bin/env node
/**
 * Renders docs/diagrams/*.html to docs/assets/*.png with a headless
 * Chromium-based browser that is already installed (Chrome or Edge), so the
 * project needs no extra dependency just for documentation.
 *
 *   npm run diagrams              # render all
 *   npm run diagrams -- data-model  # render the ones whose name matches
 *
 * Set CHROME_PATH to use a specific browser binary.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const srcDir = join(root, "docs", "diagrams");
const outDir = join(root, "docs", "assets");
const scale = Number(process.env.DIAGRAM_SCALE ?? 2);
const filter = process.argv[2];

const candidates = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/microsoft-edge",
].filter(Boolean);

const browser = candidates.find((p) => existsSync(p));
if (!browser) {
  console.error("No Chrome or Edge found. Set CHROME_PATH to a Chromium-based browser binary.");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const files = readdirSync(srcDir)
  .filter((f) => f.endsWith(".html"))
  .filter((f) => !filter || f.includes(filter));

for (const file of files) {
  const html = readFileSync(join(srcDir, file), "utf8");
  const size = html.match(/<meta name="diagram-size" content="(\d+)x(\d+)"/);
  if (!size) {
    console.warn(`skip ${file}: no <meta name="diagram-size">`);
    continue;
  }
  const [, width, height] = size;
  const out = join(outDir, `${basename(file, ".html")}.png`);
  const profile = mkdtempSync(join(tmpdir(), "documind-diagram-"));
  try {
    execFileSync(
      browser,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-first-run",
        "--no-default-browser-check",
        `--user-data-dir=${profile}`,
        `--force-device-scale-factor=${scale}`,
        `--window-size=${width},${height}`,
        "--virtual-time-budget=10000",
        `--screenshot=${out}`,
        pathToFileURL(join(srcDir, file)).href,
      ],
      { stdio: "pipe" },
    );
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
  const kb = (statSync(out).size / 1024).toFixed(0);
  console.log(`✓ ${file} → docs/assets/${basename(out)} (${width}×${height} @${scale}x, ${kb} KB)`);
}
