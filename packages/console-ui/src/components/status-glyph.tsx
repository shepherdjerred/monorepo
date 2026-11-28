import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  InfoIcon,
  OctagonAlertIcon,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Severity } from "@shepherdjerred/console-ui/tokens.ts";

export const SEVERITY_ICON: Readonly<Record<Severity, LucideIcon>> = {
  ok: CircleCheckIcon,
  info: InfoIcon,
  unknown: CircleHelpIcon,
  warning: CircleAlertIcon,
  error: OctagonAlertIcon,
};

export const SEVERITY_LABEL: Readonly<Record<Severity, string>> = {
  ok: "OK",
  info: "Info",
  unknown: "Unknown",
  warning: "Warning",
  error: "Error",
};

export type StatusGlyphProps = {
  readonly severity: Severity;
  /**
   * Defaults to the severity's name ("Warning"); pass e.g. "Critical" or
   * "Running" to rename. Rich content (a link, a count) is allowed.
   */
  readonly label?: ReactNode;
  /**
   * Shows only the glyph. The label stays in the accessibility tree, so
   * status is never conveyed by colour alone.
   */
  readonly hideLabel?: boolean;
  /**
   * Replaces the severity's glyph with another lucide icon (e.g. a spinner
   * for "Running", a clock for "Queued"); the colour stays the severity's.
   */
  readonly icon?: LucideIcon;
};

/** A 14px severity glyph in the severity colour, with its word. */
export function StatusGlyph({
  severity,
  label = SEVERITY_LABEL[severity],
  hideLabel = false,
  icon,
}: StatusGlyphProps): React.JSX.Element {
  const Icon = icon ?? SEVERITY_ICON[severity];
  return (
    <span className="ui-glyph" data-sev={severity}>
      <Icon className="ui-glyph-icon" aria-hidden="true" />
      <span className={hideLabel ? "ui-sr-only" : "ui-glyph-label"}>
        {label}
      </span>
    </span>
  );
}
