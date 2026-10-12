import IconBroadcast from "~icons/ph/broadcast-fill";
import IconRotate from "~icons/ph/device-rotate-fill";

/**
 * Stands in for the live feed when this browser is not driving: the picture is
 * only sent to seated drivers, and everyone else watches the Go-Live stream.
 */
export function Stage({ message }: { message: string }) {
  return (
    <div className="relative flex aspect-[16/9] items-center justify-center overflow-hidden rounded-2xl border border-border-subtle bg-surface-card shadow-card sm:aspect-[21/9] xl:aspect-[3/1]">
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "conic-gradient(#fff 25%, transparent 0 50%, #fff 0 75%, transparent 0)",
          backgroundSize: "28px 28px",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_20%,var(--color-surface-card)_75%)]"
      />
      <div className="relative flex max-w-md flex-col items-center gap-3 px-6 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-2xl text-brand-strong">
          <IconBroadcast />
        </span>
        <p className="text-base font-semibold text-ink">{message}</p>
        <p className="text-xs text-ink-faint">
          Drivers get a low-latency feed right here. Spectators watch the
          Go-Live stream in the Discord voice channel.
        </p>
      </div>
    </div>
  );
}

export function RotateHint() {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-brand/25 bg-brand-soft px-4 py-3">
      <IconRotate className="size-7 shrink-0 text-brand-strong" />
      <div>
        <p className="text-sm font-semibold text-ink">
          Turn your phone sideways
        </p>
        <p className="text-xs text-ink-muted">
          Landscape opens the full touch controller around the feed. A Bluetooth
          gamepad works too.
        </p>
      </div>
    </div>
  );
}
