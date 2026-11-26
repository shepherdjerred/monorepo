import { PIN_PATH } from "#client/lib/pin-shape.ts";

/**
 * One comment pin: a speech bubble with the thread number (or a count) inside
 * and its tail tip on the anchor. Filled for a thread on the version shown,
 * hollow for another version, dashed when the position is approximate. The box
 * is 26 x 30 and CSS translates it so the tail tip sits at `left`/`top`.
 */
export function PinBubble({
  label,
  text,
  selected,
  hollow,
  resolved,
  approximate,
  boardPin = false,
  style,
  onClick,
}: {
  readonly label: string;
  readonly text: string | number;
  readonly selected: boolean;
  readonly hollow: boolean;
  readonly resolved: boolean;
  readonly approximate: boolean;
  readonly boardPin?: boolean;
  readonly style?: React.CSSProperties;
  readonly onClick: (event: React.MouseEvent) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="ar-pin"
      data-testid="pin"
      data-selected={selected}
      data-hollow={hollow}
      data-resolved={resolved}
      data-approximate={approximate}
      data-board-pin={boardPin}
      style={style}
      aria-pressed={selected}
      aria-label={label}
      title={approximate ? "Approximate position" : undefined}
      onClick={onClick}
    >
      <svg viewBox="0 0 26 30" aria-hidden="true" focusable="false">
        <path d={PIN_PATH} />
      </svg>
      <span className="ar-pin-n">{text}</span>
    </button>
  );
}
