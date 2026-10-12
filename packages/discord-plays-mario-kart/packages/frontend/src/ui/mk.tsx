// Mario Kart 64 motifs, drawn in CSS: the checkered flag, the track kerb, the
// item box, and the results-screen placement lettering.
import { ordinal } from "#src/stats/format.ts";
import { cx } from "./cx.ts";

/** A thin checkered-flag band. */
export function CheckerStrip({
  className,
  rolling = false,
}: {
  className?: string;
  /** Slowly scroll the pattern, like a waving flag. */
  rolling?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className={cx(
        "mk-checker opacity-90",
        rolling && "animate-checker-roll",
        className,
      )}
    />
  );
}

/** A red-and-white kerb segment. */
export function Kerb({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx("mk-kerb inline-block rounded-sm", className)}
    />
  );
}

/**
 * The item box: a rainbow cube with a "?" that bobs while something loads or
 * stands in for an empty state.
 */
export function ItemBox({
  size = 44,
  bobbing = true,
  className,
}: {
  size?: number;
  bobbing?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "relative inline-flex shrink-0 items-center justify-center",
        bobbing && "animate-item-bob",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <span className="mk-rainbow absolute inset-0 animate-item-box rounded-[22%] opacity-90 shadow-[0_6px_18px_-4px_rgb(66_184_255/0.45)]" />
      <span className="absolute inset-[3px] rounded-[18%] border border-white/50 bg-white/10 backdrop-blur-[1px]" />
      <span
        className="mk-title relative text-white"
        style={{ fontSize: size * 0.55 }}
      >
        ?
      </span>
    </span>
  );
}

const PLACE_COLOURS = new Map<number, string>([
  [1, "bg-[linear-gradient(180deg,#fff3b0_0%,#ffd23f_45%,#e0a000_100%)]"],
  [2, "bg-[linear-gradient(180deg,#ffffff_0%,#d9e1ef_50%,#9aa6bd_100%)]"],
  [3, "bg-[linear-gradient(180deg,#ffd9b8_0%,#e3965a_50%,#a85a22_100%)]"],
]);

/**
 * A placement in the results-screen style: chunky italic lettering, gold,
 * silver and bronze for the podium, plain for 4th to 8th.
 */
export function Placement({
  place,
  className,
}: {
  place: number;
  className?: string;
}) {
  const podium = PLACE_COLOURS.get(place);
  return (
    <span
      className={cx(
        "inline-block font-display leading-none whitespace-nowrap italic",
        className,
      )}
      // Stacked drop shadows outline the glyphs without a text stroke, which
      // would eat into the gradient fill.
      style={{
        filter:
          "drop-shadow(0 0.07em 0 rgb(10 12 30 / 0.95)) drop-shadow(0.04em 0 0 rgb(10 12 30 / 0.9)) drop-shadow(-0.04em 0 0 rgb(10 12 30 / 0.9)) drop-shadow(0 -0.03em 0 rgb(10 12 30 / 0.8))",
      }}
    >
      <span
        className={cx(
          podium === undefined
            ? "text-ink-muted"
            : cx(podium, "bg-clip-text text-transparent"),
        )}
      >
        {ordinal(place)}
      </span>
    </span>
  );
}
