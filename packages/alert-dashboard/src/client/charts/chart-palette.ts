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

export const CHART_CHROME: Record<
  Theme,
  { axis: string; grid: string; baseline: string }
> = {
  light: { axis: "#6b6a65", grid: "#e1e0d9", baseline: "#c3c2b7" },
  dark: { axis: "#a09f98", grid: "#2c2c2a", baseline: "#383835" },
};

export function seriesColor(theme: Theme, index: number): string {
  const palette = CATEGORICAL[theme];
  const color = palette[index % palette.length];
  if (color === undefined) throw new Error("Categorical palette is empty");
  return color;
}
