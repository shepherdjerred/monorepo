import type { Pin } from "#client/lib/pins.ts";
import { formatClock } from "#client/lib/format.ts";

/**
 * Pins on a timeline under a player. Only threads anchored to a time appear;
 * selecting one seeks the player to it.
 */
export function TimeStrip({
  pins,
  duration,
  selectedId,
  onSelect,
  onSeek,
}: {
  readonly pins: readonly Pin[];
  readonly duration: number;
  readonly selectedId: string | null;
  readonly onSelect: (threadId: string) => void;
  readonly onSeek: (seconds: number) => void;
}): React.JSX.Element | null {
  const timed = pins.flatMap((pin) =>
    pin.anchor.type === "time" ? [{ pin, t: pin.anchor.t }] : [],
  );
  if (timed.length === 0 || duration <= 0) return null;
  return (
    <div
      className="ar-time-strip"
      role="group"
      aria-label="Comments on the timeline"
    >
      {timed.map(({ pin, t }) => (
        <button
          key={pin.id}
          type="button"
          className="ar-time-pin"
          data-selected={pin.id === selectedId}
          data-hollow={pin.stale}
          data-resolved={pin.state === "resolved"}
          style={{
            left: `calc(14px + (100% - 28px) * ${String(Math.min(1, t / duration))})`,
          }}
          aria-label={`Thread ${String(pin.index)} at ${formatClock(t)}`}
          onClick={() => {
            onSeek(t);
            onSelect(pin.id);
          }}
        >
          {pin.index}
        </button>
      ))}
    </div>
  );
}
