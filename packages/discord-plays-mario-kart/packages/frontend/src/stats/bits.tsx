import type { ReactNode } from "react";
import IconSpinner from "~icons/ph/circle-notch-bold";
import IconWarning from "~icons/ph/warning-circle-fill";
import { Button } from "#src/ui/button.tsx";
import { cx } from "#src/ui/cx.ts";
import { ordinal } from "./format.ts";

const PLACE_STYLES: Record<number, string> = {
  1: "bg-gold/15 text-gold ring-gold/30",
  2: "bg-silver/10 text-silver ring-silver/25",
  3: "bg-bronze/15 text-bronze ring-bronze/30",
};

/** A placement chip: gold, silver and bronze for the podium. */
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
        "inline-flex shrink-0 items-center justify-center rounded-md font-bold tabular-nums ring-1",
        size === "sm"
          ? "h-5 min-w-8 px-1 text-[10px]"
          : "h-6 min-w-10 px-1.5 text-xs",
        PLACE_STYLES[place] ?? "bg-white/5 text-ink-muted ring-white/10",
      )}
    >
      {ordinal(place)}
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
    <div className="rounded-xl border border-border-subtle bg-surface-sunken px-3 py-2.5">
      <div className="text-[11px] font-medium text-ink-faint">{label}</div>
      <div className="mt-0.5 text-xl font-bold text-ink tabular-nums">
        {value}
      </div>
      {sub === undefined ? null : (
        <div className="text-[11px] text-ink-faint">{sub}</div>
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
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      {icon === undefined ? null : (
        <div className="text-2xl text-ink-faint">{icon}</div>
      )}
      <p className="text-sm font-semibold text-ink-muted">{title}</p>
      {children === undefined ? null : (
        <div className="max-w-xs text-xs text-ink-faint">{children}</div>
      )}
    </div>
  );
}

export function PanelLoading() {
  return (
    <div className="flex justify-center py-12 text-ink-faint">
      <IconSpinner className="size-5 animate-spin" />
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
