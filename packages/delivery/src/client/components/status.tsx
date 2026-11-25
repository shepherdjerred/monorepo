import type { Severity } from "@shepherdjerred/console-ui";
import {
  BanIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  ClockIcon,
  InfoIcon,
  LoaderCircleIcon,
  MinusIcon,
  OctagonAlertIcon,
  PauseCircleIcon,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

type StatusMeta = {
  readonly severity: Severity;
  readonly icon: LucideIcon;
};

const DEFAULT_META: StatusMeta = {
  severity: "unknown",
  icon: CircleHelpIcon,
};

const STATUS_META: Readonly<Record<string, StatusMeta>> = {
  succeeded: { severity: "ok", icon: CircleCheckIcon },
  verified: { severity: "ok", icon: CircleCheckIcon },
  settled: { severity: "ok", icon: CircleCheckIcon },
  granted: { severity: "ok", icon: CircleCheckIcon },
  failed: { severity: "error", icon: OctagonAlertIcon },
  alarmed: { severity: "error", icon: CircleAlertIcon },
  rejected: { severity: "error", icon: OctagonAlertIcon },
  running: { severity: "info", icon: LoaderCircleIcon },
  watching: { severity: "info", icon: InfoIcon },
  awaiting_approval: { severity: "warning", icon: PauseCircleIcon },
  queued: { severity: "warning", icon: ClockIcon },
  pending: { severity: "warning", icon: ClockIcon },
  canceled: { severity: "unknown", icon: BanIcon },
  not_started: { severity: "unknown", icon: MinusIcon },
  unmonitored: { severity: "unknown", icon: MinusIcon },
  expired: { severity: "unknown", icon: ClockIcon },
  unknown: DEFAULT_META,
};

export function statusLabel(value: string) {
  return value.replaceAll("_", " ");
}

/**
 * Status as a console-ui severity glyph, words, and color, so no channel
 * carries it alone. `value` picks the Lucide icon and `data-sev` severity;
 * `label` replaces the words when a page has its own for that state, such as a
 * commit's "Deployed" or "CI failed".
 */
export function Status({ value, label }: { value: string; label?: ReactNode }) {
  const { severity, icon: Icon } = STATUS_META[value] ?? DEFAULT_META;
  return (
    <span className={`status status-${value}`} data-sev={severity}>
      <Icon className="status-glyph" aria-hidden="true" />
      <span className="status-label">{label ?? statusLabel(value)}</span>
    </span>
  );
}
