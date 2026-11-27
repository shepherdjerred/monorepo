import { PALETTE } from "./palette.ts";

const SIZES = [
  { id: "s", label: "Small text" },
  { id: "m", label: "Medium text" },
  { id: "l", label: "Large text" },
] as const;

/**
 * Colours for the annotation being drawn and the selected ones, and the size
 * of a selected title. It floats above the tool pill while either applies.
 */
export function PalettePill({
  color,
  titleSize,
  onColor,
  onTitleSize,
}: {
  readonly color: string;
  /** The size of the selected title, or null when no title is selected. */
  readonly titleSize: "s" | "m" | "l" | null;
  readonly onColor: (id: string) => void;
  readonly onTitleSize: (size: "s" | "m" | "l") => void;
}): React.JSX.Element {
  return (
    <div
      className="ar-cv-palette"
      role="toolbar"
      aria-label="Annotation colour"
      data-cv-ignore=""
      data-testid="palette"
    >
      {PALETTE.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className="ar-cv-swatch"
          aria-label={entry.label}
          aria-pressed={color === entry.id}
          title={entry.label}
          style={{ background: entry.fill, borderColor: entry.stroke }}
          onClick={() => {
            onColor(entry.id);
          }}
        />
      ))}
      {titleSize === null ? null : (
        <>
          <span className="ar-cv-sep" aria-hidden="true" />
          {SIZES.map((size) => (
            <button
              key={size.id}
              type="button"
              className="ar-cv-size"
              aria-label={size.label}
              aria-pressed={titleSize === size.id}
              onClick={() => {
                onTitleSize(size.id);
              }}
            >
              {size.id.toUpperCase()}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
