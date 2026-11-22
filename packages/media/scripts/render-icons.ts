/**
 * `bun scripts/render-icons.ts` — draws the PNG icons in `public/icons` from
 * the hand-written SVG beside them, with the Chromium the browser suite
 * already installs (`bunx playwright install chromium`). Run it after
 * changing an SVG and commit the PNGs it rewrites; nothing renders them at
 * build time.
 *
 * `src/server/static/web-app.test.ts` holds each PNG to the size named here
 * and in `public/manifest.webmanifest`.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const ICONS = path.resolve(import.meta.dir, "../public/icons");

const RENDERS = [
  // The favicon of a browser that takes no SVG one.
  { source: "favicon.svg", output: "favicon-32.png", size: 32 },
  { source: "icon.svg", output: "icon-192.png", size: 192 },
  { source: "icon.svg", output: "icon-512.png", size: 512 },
  { source: "icon-maskable.svg", output: "icon-maskable-512.png", size: 512 },
  { source: "apple-touch-icon.svg", output: "apple-touch-icon.png", size: 180 },
] as const;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const { source, output, size } of RENDERS) {
    // An SVG with a view box and no size of its own fills the window, so a
    // square window of `size` pixels is the icon at that size.
    await page.setViewportSize({ width: size, height: size });
    await page.goto(pathToFileURL(path.join(ICONS, source)).href);
    await page.screenshot({
      path: path.join(ICONS, output),
      // Keeps the corners of the rounded tile transparent.
      omitBackground: true,
    });
    process.stdout.write(`${output} ${String(size)}x${String(size)}\n`);
  }
} finally {
  await browser.close();
}
