import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { scoutThemes } from "#src/generated/tokens.ts";
import { scoutOgCard } from "#src/brand/og-card.ts";
import { outlineText } from "./outline-font.ts";
import {
  scoutMarkInner,
  scoutMarkStroke,
  scoutMarkSvg,
  scoutTileSvg,
} from "#src/brand/geometry.ts";

const check = Bun.argv.includes("--check");
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const brandDir = `${packageRoot}assets/brand/`;
const fontsDir = `${packageRoot}assets/fonts/`;
const frontendPublic = fileURLToPath(
  new URL("../../frontend/public/", import.meta.url),
);
const evalsPublic = fileURLToPath(
  new URL("../../evals/public/", import.meta.url),
);
const desktopDir = fileURLToPath(new URL("../../desktop/", import.meta.url));
const desktopIcons = `${desktopDir}src-tauri/icons/`;
const colors = scoutThemes["modern-light"].colors;
const dark = scoutThemes["modern-dark"].colors;

const beaufortBold = `${fontsDir}BeaufortForLoL-TTF/BeaufortforLOL-Bold.ttf`;
const spiegelRegular = `${fontsDir}Spiegel-TTF/Spiegel_TT_Regular.ttf`;
const spiegelSemiBold = `${fontsDir}Spiegel-TTF/Spiegel_TT_SemiBold.ttf`;

function pngFromSvg(svg: string, width: number): Uint8Array {
  return new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: {
      fontFiles: [beaufortBold, spiegelRegular],
      loadSystemFonts: false,
      defaultFontFamily: "Beaufort for LoL",
    },
  })
    .render()
    .asPng();
}

function icoFromPngs(images: { size: number; png: Uint8Array }[]): Uint8Array {
  const count = images.length;
  const headerSize = 6 + 16 * count;
  let offset = headerSize;
  const entries = images.map((image) => {
    const entry = { ...image, offset };
    offset += image.png.byteLength;
    return entry;
  });
  const out = new Uint8Array(offset);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, count, true);
  entries.forEach((entry, index) => {
    const base = 6 + index * 16;
    out[base] = entry.size >= 256 ? 0 : entry.size;
    out[base + 1] = entry.size >= 256 ? 0 : entry.size;
    out[base + 2] = 0;
    out[base + 3] = 0;
    view.setUint16(base + 4, 1, true);
    view.setUint16(base + 6, 32, true);
    view.setUint32(base + 8, entry.png.byteLength, true);
    view.setUint32(base + 12, entry.offset, true);
    out.set(entry.png, entry.offset);
  });
  return out;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
}

async function emit(
  filePath: string,
  data: string | Uint8Array,
): Promise<void> {
  if (!check) {
    await Bun.write(filePath, data);
    return;
  }
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    throw new Error(`Missing generated Scout brand file: ${filePath}`);
  }
  if (typeof data === "string") {
    if ((await file.text()) !== data) {
      throw new Error(`Scout brand asset drifted: ${filePath}`);
    }
    return;
  }
  if (!sameBytes(new Uint8Array(await file.arrayBuffer()), data)) {
    throw new Error(`Scout brand asset drifted: ${filePath}`);
  }
}

const emblem = scoutMarkSvg({
  stroke: "currentColor",
  fill: "currentColor",
  strokeWidth: scoutMarkStroke.ui,
});
const compass = scoutMarkSvg({
  stroke: colors.primary,
  fill: colors.primary,
  strokeWidth: scoutMarkStroke.favicon,
  ariaLabel: "Scout",
});
const appleTouch = scoutTileSvg({
  size: 180,
  radius: 40,
  canvas: colors.canvas,
  stroke: colors.primary,
  fill: colors.primary,
  strokeWidth: scoutMarkStroke.favicon,
  ariaLabel: "Scout",
});
const appIcon = scoutTileSvg({
  size: 512,
  radius: 108,
  canvas: colors.canvas,
  stroke: colors.primary,
  fill: colors.primary,
  strokeWidth: scoutMarkStroke.favicon,
  ariaLabel: "Scout",
});
const discordIcon = scoutTileSvg({
  size: 1024,
  radius: 0,
  canvas: dark.canvas,
  stroke: dark.primary,
  fill: dark.primary,
  strokeWidth: scoutMarkStroke.favicon,
  ariaLabel: "Scout",
});

const scoutWord = await outlineText({
  font: beaufortBold,
  text: "SCOUT",
  x: 176,
  y: 104,
  size: 72,
  tracking: 10,
});
const bannerScout = await outlineText({
  font: beaufortBold,
  text: "SCOUT",
  x: 500,
  y: 230,
  size: 92,
  tracking: 14,
});
const bannerLeague = await outlineText({
  font: beaufortBold,
  text: "FOR LEAGUE OF LEGENDS",
  x: 500,
  y: 300,
  size: 28,
  tracking: 3,
});
const bannerTag = await outlineText({
  font: spiegelRegular,
  text: "Match alerts and post-match reports in Discord",
  x: 500,
  y: 360,
  size: 24,
  tracking: 0,
});
const discordScout = await outlineText({
  font: beaufortBold,
  text: "SCOUT",
  x: 230,
  y: 128,
  size: 64,
  tracking: 8,
});
const discordLeague = await outlineText({
  font: beaufortBold,
  text: "FOR LEAGUE OF LEGENDS",
  x: 230,
  y: 172,
  size: 16,
  tracking: 2,
});

const markPaint = {
  stroke: colors.primary,
  fill: colors.primary,
  strokeWidth: scoutMarkStroke.ui,
};
const darkMarkPaint = {
  stroke: dark.primary,
  fill: dark.primary,
  strokeWidth: scoutMarkStroke.ui,
};

const wordmark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 160" role="img" aria-label="Scout">
  <g transform="translate(16 16) scale(4)" fill="none">${scoutMarkInner(markPaint)}</g>
  <path fill="${colors.primary}" d="${scoutWord}"/>
</svg>
`;

const banner = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1500 500" role="img" aria-label="Scout for League of Legends">
  <rect width="1500" height="500" fill="${colors.canvas}"/>
  <g transform="translate(120 90) scale(10)" fill="none">${scoutMarkInner(markPaint)}</g>
  <path fill="${colors.primary}" d="${bannerScout}"/>
  <path fill="${colors.primary}" d="${bannerLeague}"/>
  <path fill="${colors.textMuted}" d="${bannerTag}"/>
</svg>
`;

const discordBanner = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 240" role="img" aria-label="Scout">
  <rect width="680" height="240" fill="${dark.canvas}"/>
  <g transform="translate(28 36) scale(5.25)" fill="none">${scoutMarkInner(darkMarkPaint)}</g>
  <path fill="${dark.primary}" d="${discordScout}"/>
  <path fill="${dark.primary}" d="${discordLeague}"/>
</svg>
`;

await mkdir(brandDir, { recursive: true });
await mkdir(evalsPublic, { recursive: true });

await emit(`${brandDir}emblem.svg`, emblem);
await emit(`${brandDir}compass.svg`, compass);
await emit(`${brandDir}apple-touch.svg`, appleTouch);
await emit(`${brandDir}app-icon.svg`, appIcon);
await emit(`${brandDir}wordmark.svg`, wordmark);
await emit(`${brandDir}banner.svg`, banner);

const png48 = pngFromSvg(compass, 48);
const png16 = pngFromSvg(compass, 16);
const png32 = pngFromSvg(compass, 32);
const png180 = pngFromSvg(appleTouch, 180);
const png192 = pngFromSvg(appleTouch, 192);
const png512 = pngFromSvg(appIcon, 512);

await emit(`${brandDir}wordmark.png`, pngFromSvg(wordmark, 720));
await emit(`${brandDir}banner.png`, pngFromSvg(banner, 1500));
await emit(`${brandDir}app-icon-512.png`, png512);
await emit(`${brandDir}discord-icon.png`, pngFromSvg(discordIcon, 1024));
await emit(`${brandDir}discord-banner.png`, pngFromSvg(discordBanner, 680));
await emit(`${frontendPublic}favicon.svg`, compass);
await emit(`${frontendPublic}favicon-48x48.png`, png48);
await emit(`${frontendPublic}apple-touch-icon.png`, png180);
await emit(`${frontendPublic}icon-192.png`, png192);
await emit(`${frontendPublic}icon-512.png`, png512);
await emit(
  `${frontendPublic}favicon.ico`,
  icoFromPngs([
    { size: 16, png: png16 },
    { size: 32, png: png32 },
    { size: 48, png: png48 },
  ]),
);
await emit(`${evalsPublic}favicon.svg`, compass);

const ogSvg = await satori(
  scoutOgCard({
    title: "Scout for League of Legends",
    description:
      "Get notified when your friends start matches and get post-match reports in Discord.",
  }),
  {
    width: 1200,
    height: 630,
    fonts: [
      {
        name: "Beaufort for LoL",
        weight: 700,
        style: "normal",
        data: await Bun.file(beaufortBold).arrayBuffer(),
      },
      {
        name: "Spiegel",
        weight: 400,
        style: "normal",
        data: await Bun.file(spiegelRegular).arrayBuffer(),
      },
      {
        name: "Spiegel",
        weight: 600,
        style: "normal",
        data: await Bun.file(spiegelSemiBold).arrayBuffer(),
      },
    ],
  },
);
await emit(`${brandDir}og-default.png`, pngFromSvg(ogSvg, 1200));

const tauriOut = check
  ? path.join(tmpdir(), `scout-brand-icons-${String(process.pid)}`)
  : desktopIcons;
await mkdir(tauriOut, { recursive: true });
const tauriSource = check
  ? path.join(tauriOut, "source.png")
  : `${brandDir}app-icon-512.png`;
if (check) {
  await Bun.write(tauriSource, png512);
}
const tauri = Bun.spawnSync(
  [
    "bunx",
    "@tauri-apps/cli",
    "icon",
    tauriSource,
    "-o",
    tauriOut,
    "--ios-color",
    colors.canvas,
  ],
  { cwd: desktopDir, stdout: "inherit", stderr: "inherit" },
);
if (tauri.exitCode !== 0) {
  throw new Error("Failed to generate Tauri icons");
}
if (check) {
  for (const name of ["icon.png", "32x32.png", "128x128.png"]) {
    const expected = new Uint8Array(
      await Bun.file(`${desktopIcons}${name}`).arrayBuffer(),
    );
    const actual = new Uint8Array(
      await Bun.file(path.join(tauriOut, name)).arrayBuffer(),
    );
    if (!sameBytes(expected, actual)) {
      throw new Error(`Scout desktop icon drifted: ${name}`);
    }
  }
}

console.log(
  check ? "Scout brand assets are in sync" : "Generated Scout brand assets",
);
