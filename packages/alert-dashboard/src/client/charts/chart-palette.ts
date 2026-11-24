import { tokens } from "@shepherdjerred/console-ui/tokens.ts";

import type { Theme } from "#client/theme.ts";

/**
 * Categorical series colors in fixed order (validated adjacent-pair CVD-safe
 * in both modes). A series keeps its slot by name order, never by rank.
 * Beyond eight series the chart folds the rest into the legend-only tail.
 */
export const CATEGORICAL: Record<Theme, readonly string[]> = {
  light: [
    "#2a78d6",
    "#eb6834",
    "#1baf7a",
    "#eda100",
    "#e87ba4",
    "#008300",
    "#4a3aa7",
    "#e34948",
  ],
  dark: [
    "#3987e5",
    "#d95926",
    "#199e70",
    "#c98500",
    "#d55181",
    "#008300",
    "#9085e9",
    "#e66767",
  ],
};

function chrome(theme: Theme): {
  axis: string;
  grid: string;
  baseline: string;
} {
  const values = tokens[theme];
  return {
    axis: values.faint,
    grid: values.line,
    baseline: values["btn-edge"],
  };
}

/**
 * Axis labels, grid lines and the zero line, from the shared console tokens
 * so charts match the panel they sit on: axis text is the faint ink, the grid
 * is the table line colour, and the baseline is the control edge.
 */
export const CHART_CHROME: Record<
  Theme,
  { axis: string; grid: string; baseline: string }
> = {
  light: chrome("light"),
  dark: chrome("dark"),
};

export const STACKED_AREA_ALPHA: Record<Theme, number> = {
  light: 0.28,
  dark: 0.32,
};

export const BAR_FILL_ALPHA: Record<Theme, number> = {
  light: 0.24,
  dark: 0.3,
};

/** Threshold lines use the severity glyph colours of the shared tokens. */
const THRESHOLD_TONE: Record<Theme, Record<"warning" | "error", string>> = {
  light: {
    warning: tokens.light["sev-warning"],
    error: tokens.light["sev-error"],
  },
  dark: {
    warning: tokens.dark["sev-warning"],
    error: tokens.dark["sev-error"],
  },
};

export function seriesColor(theme: Theme, index: number): string {
  const palette = CATEGORICAL[theme];
  const color = palette[index % palette.length];
  if (color === undefined) {
    throw new Error("Categorical palette is empty");
  }
  return color;
}

export function hexWithAlpha(hex: string, alpha: number): string {
  const clean = hex.startsWith("#") ? hex.slice(1) : hex;
  if (clean.length !== 6) {
    throw new Error(`Expected 6-digit hex color, received ${hex}`);
  }
  const red = Number.parseInt(clean.slice(0, 2), 16);
  const green = Number.parseInt(clean.slice(2, 4), 16);
  const blue = Number.parseInt(clean.slice(4, 6), 16);
  return `rgba(${String(red)}, ${String(green)}, ${String(blue)}, ${String(alpha)})`;
}

export function seriesFillColor(
  theme: Theme,
  index: number,
  alpha = STACKED_AREA_ALPHA[theme],
): string {
  return hexWithAlpha(seriesColor(theme, index), alpha);
}

export function barFillColor(theme: Theme, index: number): string {
  return hexWithAlpha(seriesColor(theme, index), BAR_FILL_ALPHA[theme]);
}

export function thresholdColor(
  theme: Theme,
  tone: "warning" | "error" = "warning",
): string {
  return THRESHOLD_TONE[theme][tone];
}
