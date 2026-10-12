import type { ReactNode } from "react";
import IconWarning from "~icons/ph/warning-circle-fill";
import { Button } from "#src/ui/button.tsx";
import { cx } from "#src/ui/cx.ts";
import { ItemBox, Placement } from "#src/ui/mk.tsx";
import { formatLapTimer, formatRaceTime } from "./format.ts";

/** A placement in the game's results lettering: gold, silver, bronze, then plain. */
export function PlaceBadge({
  place,
  size = "md",
}: {
  place: number;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 justify-center",
        size === "sm" ? "w-9 text-[15px]" : "w-11 text-lg",
      )}
    >
      <Placement place={place} />
    </span>
  );
}

/** A race time in the in-game timer's style: 1'23"45 in yellow HUD digits. */
export function LapTime({
  ms,
  finished = true,
  className,
}: {
  ms: number;
  finished?: boolean;
  className?: string;
}) {
  return finished ? (
    <span className={cx("mk-hud", className)} aria-label={formatRaceTime(ms)}>
      {formatLapTimer(ms)}
    </span>
  ) : (
    <span className={cx("font-display text-ink-faint italic", className)}>
      DNF
    </span>
  );
}

export function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border-subtle bg-surface-sunken px-3 py-2.5">
      <div className="text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
        {label}
      </div>
      <div className="mk-title mt-0.5 text-[28px] leading-none text-white">
        {value}
      </div>
      {sub === undefined ? null : (
        <div className="mt-1 text-[11px] text-ink-muted">{sub}</div>
      )}
    </div>
  );
}

export function PanelMessage({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2.5 px-6 py-10 text-center">
      {icon === undefined ? (
        <ItemBox size={48} bobbing={false} />
      ) : (
        <div className="text-3xl">{icon}</div>
      )}
      <p className="mk-title text-xl text-white">{title}</p>
      {children === undefined ? null : (
        <div className="max-w-xs text-xs leading-relaxed text-ink-muted">
          {children}
        </div>
      )}
    </div>
  );
}

export function PanelLoading() {
  return (
    <div className="flex flex-col items-center gap-3 py-12" role="status">
      <ItemBox size={44} />
      <span className="text-xs font-medium text-ink-muted">Loading…</span>
    </div>
  );
}

export function PanelError({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}) {
  return (
    <PanelMessage
      icon={<IconWarning className="text-amber-300" />}
      title="Couldn't load this"
    >
      <p>{error.message}</p>
      <Button size="sm" className="mt-3" onClick={onRetry}>
        Try again
      </Button>
    </PanelMessage>
  );
}

export function PanelQueryError({
  error,
  refetch,
}: {
  error: Error;
  refetch: () => Promise<unknown>;
}) {
  return (
    <PanelError
      error={error}
      onRetry={() => {
        void refetch();
      }}
    />
  );
}
