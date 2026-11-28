/** The colours annotations are drawn in. A note stores the id; the fill and stroke are the app's. */
export type PaletteColor = {
  readonly id: string;
  readonly label: string;
  /** Sticky fill. */
  readonly fill: string;
  /** Lines, arrows, boxes and strokes; titles use it for their text. */
  readonly stroke: string;
  /** Text on a sticky. */
  readonly ink: string;
};

export const PALETTE: readonly PaletteColor[] = [
  {
    id: "yellow",
    label: "Yellow",
    fill: "#fde68a",
    stroke: "#b45309",
    ink: "#3b2f05",
  },
  {
    id: "red",
    label: "Red",
    fill: "#fecaca",
    stroke: "#dc2626",
    ink: "#450a0a",
  },
  {
    id: "green",
    label: "Green",
    fill: "#bbf7d0",
    stroke: "#15803d",
    ink: "#052e16",
  },
  {
    id: "blue",
    label: "Blue",
    fill: "#bfdbfe",
    stroke: "#2563eb",
    ink: "#0a1f4d",
  },
  {
    id: "violet",
    label: "Violet",
    fill: "#ddd6fe",
    stroke: "#7c3aed",
    ink: "#2e1065",
  },
  {
    id: "gray",
    label: "Gray",
    fill: "#e5e7eb",
    stroke: "#374151",
    ink: "#111827",
  },
];

export const DEFAULT_COLOR = "yellow";

const FALLBACK: PaletteColor = {
  id: "gray",
  label: "Gray",
  fill: "#e5e7eb",
  stroke: "#374151",
  ink: "#111827",
};

/** A note's colour; an unknown id (an agent wrote one) draws gray. */
export function paletteColor(id: string | undefined): PaletteColor {
  return PALETTE.find((entry) => entry.id === id) ?? FALLBACK;
}
