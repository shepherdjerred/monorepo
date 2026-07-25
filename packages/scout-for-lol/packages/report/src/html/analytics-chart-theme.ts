import { fileURLToPath } from "node:url";
import type { ReportChartPalette, ReportChartTheme } from "@scout-for-lol/data";
import chroma from "chroma-js";
import { palette } from "#src/assets/colors.ts";

export type AnalyticsChartStyle = {
  theme?: ReportChartTheme;
  palette?: ReportChartPalette;
  colors?: string[];
};

export type AnalyticsChartTheme = {
  background: string | object;
  panel: string;
  text: string;
  muted: string;
  accent: string;
  grid: string;
  border: string;
};

export const ANALYTICS_CHART_WIDTH = 1600;
export const ANALYTICS_CHART_HEIGHT = 900;
export const ANALYTICS_TITLE_FONT = "Beaufort for LOL";
export const ANALYTICS_BODY_FONT = "Spiegel";
export const ANALYTICS_FONT_FILE_PATHS = [
  "Spiegel-TTF/Spiegel_TT_Regular.ttf",
  "Spiegel-TTF/Spiegel_TT_SemiBold.ttf",
  "Spiegel-TTF/Spiegel_TT_Bold.ttf",
  "BeaufortForLoL-TTF/BeaufortforLOL-Regular.ttf",
  "BeaufortForLoL-TTF/BeaufortforLOL-Bold.ttf",
  "BeaufortForLoL-TTF/BeaufortforLOL-Heavy.ttf",
].map((name) =>
  fileURLToPath(new URL(`../assets/fonts/${name}`, import.meta.url)),
);

const DARK_GRADIENT = {
  type: "linear" as const,
  x: 0,
  y: 0,
  x2: 0,
  y2: 1,
  colorStops: [palette.grey[6], palette.blue[6], palette.grey[6]].map(
    (color, index) => ({ offset: index / 2, color }),
  ),
};

const THEMES: Record<ReportChartTheme, AnalyticsChartTheme> = {
  lol_dark: {
    background: DARK_GRADIENT,
    panel: "rgba(1, 10, 19, 0.35)",
    text: palette.grey[1],
    muted: palette.grey[2],
    accent: palette.gold.bright,
    grid: palette.grey[5],
    border: palette.gold[5],
  },
  lol_light: {
    background: "#f5eee0",
    panel: "#fffaf0",
    text: "#17202a",
    muted: "#58616b",
    accent: "#8a5d12",
    grid: "#d7c8ad",
    border: "#a98542",
  },
  minimal_dark: {
    background: "#101318",
    panel: "#181d24",
    text: "#f3f4f6",
    muted: "#a8b0bc",
    accent: "#7dd3fc",
    grid: "#343b46",
    border: "#4b5563",
  },
  minimal_light: {
    background: "#f8fafc",
    panel: "#ffffff",
    text: "#111827",
    muted: "#64748b",
    accent: "#0369a1",
    grid: "#dbe3ec",
    border: "#cbd5e1",
  },
};

const PALETTES: Record<ReportChartPalette, string[]> = {
  ranked: ["#f0bf3a", "#48b8d0", "#8b5cf6", "#10b981", "#ef4444", "#e879f9"],
  categorical: [
    "#f0bf3a",
    "#0ac8b9",
    "#60c8e4",
    "#7d4e9e",
    "#ad3138",
    "#e98f3e",
    "#6bc46d",
    "#e06c9f",
  ],
  team: [
    palette.teams.blue,
    palette.teams.red,
    palette.gold.bright,
    palette.blue[2],
  ],
  gold: ["#fff0a8", "#f0bf3a", "#c89b3c", "#785a28", "#463714"],
  colorblind: [
    "#56b4e9",
    "#e69f00",
    "#009e73",
    "#f0e442",
    "#0072b2",
    "#d55e00",
    "#cc79a7",
    "#999999",
  ],
};

export function analyticsChartTheme(
  style: AnalyticsChartStyle,
): AnalyticsChartTheme {
  return THEMES[style.theme ?? "lol_dark"];
}

export function analyticsChartColors(
  style: AnalyticsChartStyle,
  theme: AnalyticsChartTheme,
): string[] {
  const anchors = style.colors ?? PALETTES[style.palette ?? "categorical"];
  return anchors.map((color) => ensureContrast(color, theme.background));
}

function ensureContrast(color: string, background: string | object): string {
  if (typeof background !== "string") return color;
  let candidate = chroma(color);
  const backdrop = chroma(background);
  for (
    let step = 0;
    step < 6 && chroma.contrast(candidate, backdrop) < 3;
    step++
  ) {
    candidate =
      backdrop.luminance() < 0.5
        ? candidate.brighten(0.55)
        : candidate.darken(0.55);
  }
  return candidate.hex();
}
