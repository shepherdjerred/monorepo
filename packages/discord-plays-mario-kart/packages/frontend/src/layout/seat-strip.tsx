import IconPlus from "~icons/ph/plus-bold";
import type { DiscordUser } from "@shepherdjerred/discord-plays-core/auth/protocol.ts";
import { Avatar } from "#src/ui/avatar.tsx";
import { cx } from "#src/ui/cx.ts";

// MK64's own player colours: P1 red, P2 blue, P3 yellow, P4 green.
const SEAT_COLOURS = [
  {
    text: "text-[#ff4a5c]",
    ring: "ring-[#ff4a5c]/70",
    glow: "from-[#e4142c]/30",
    bar: "bg-[#e4142c]",
  },
  {
    text: "text-[#5aa8ff]",
    ring: "ring-[#5aa8ff]/70",
    glow: "from-[#1f6fe0]/30",
    bar: "bg-[#1f6fe0]",
  },
  {
    text: "text-[#ffd21f]",
    ring: "ring-[#ffd21f]/70",
    glow: "from-[#e0a800]/25",
    bar: "bg-[#ffd21f]",
  },
  {
    text: "text-[#3fdc6c]",
    ring: "ring-[#3fdc6c]/70",
    glow: "from-[#1fb054]/30",
    bar: "bg-[#1fb054]",
  },
] as const;

/**
 * P1–P4. A free seat claims on click, your own seat releases, and someone
 * else's is shown but disabled. Every button carries `data-seat` for the
 * browser harnesses.
 */
export function SeatStrip({
  seats,
  mySeat,
  onClaim,
  onRelease,
}: {
  seats: readonly (DiscordUser | null)[];
  mySeat: number | null;
  onClaim: (seat: number) => void;
  onRelease: () => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
      {seats.map((occupant, index) => {
        const colours = SEAT_COLOURS[index] ?? SEAT_COLOURS[0];
        const label = `P${String(index + 1)}`;
        const mine = index === mySeat;
        const taken = occupant !== null && !mine;
        return (
          <button
            key={label}
            type="button"
            data-seat={index}
            disabled={taken}
            aria-pressed={mine}
            aria-label={
              mine
                ? `${label}, your seat. Leave seat`
                : taken
                  ? `${label}, taken by ${occupant.name}`
                  : `${label}, open. Take this seat`
            }
            onClick={() => {
              if (mine) {
                onRelease();
              } else {
                onClaim(index);
              }
            }}
            className={cx(
              "group relative flex h-16 items-center gap-3 overflow-hidden rounded-2xl border pr-3 pl-4 text-left transition-all",
              mine
                ? cx(
                    "border-transparent bg-surface-raised ring-2",
                    colours.ring,
                  )
                : taken
                  ? "cursor-default border-border-subtle bg-surface-card"
                  : "border-dashed border-border-strong bg-surface-sunken/40 hover:border-mk-yellow/60 hover:bg-white/[0.03]",
            )}
          >
            <span
              aria-hidden="true"
              className={cx(
                "absolute inset-y-0 left-0 w-1.5",
                occupant === null ? "bg-border-strong" : colours.bar,
              )}
            />
            {occupant === null ? null : (
              <span
                className={cx(
                  "pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent opacity-80",
                  colours.glow,
                )}
              />
            )}
            <span
              className={cx(
                "mk-title relative text-[28px] leading-none",
                occupant === null ? "text-ink-faint" : colours.text,
              )}
            >
              {label}
            </span>
            {occupant === null ? (
              <span className="relative flex items-center gap-1.5 text-xs font-medium text-ink-muted group-hover:text-mk-yellow">
                <IconPlus className="size-3.5" />
                Open seat
              </span>
            ) : (
              <span className="relative flex min-w-0 items-center gap-2">
                <Avatar
                  name={occupant.name}
                  url={occupant.avatarUrl}
                  seed={occupant.discordId}
                  size="sm"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">
                    {occupant.name}
                  </span>
                  <span className="block text-[11px] text-ink-faint">
                    {mine ? "You · leave" : "Driving"}
                  </span>
                </span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
