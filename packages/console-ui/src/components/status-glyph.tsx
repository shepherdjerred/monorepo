import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  InfoIcon,
  OctagonAlertIcon,
  type LucideIcon,
} from "lucide-react";
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
  /** Defaults to the severity's name ("Warning"); pass e.g. "Critical" to rename. */
  readonly label?: string;
  /**
   * Shows only the glyph. The label stays in the accessibility tree, so
   * status is never conveyed by colour alone.
   */
  readonly hideLabel?: boolean;
};

/** A 14px severity glyph in the severity colour, with its word. */
export function StatusGlyph({
  severity,
  label = SEVERITY_LABEL[severity],
  hideLabel = false,
}: StatusGlyphProps): React.JSX.Element {
  const Icon = SEVERITY_ICON[severity];
  return (
    <span className="ui-glyph" data-sev={severity}>
      <Icon className="ui-glyph-icon" aria-hidden="true" />
      <span className={hideLabel ? "ui-sr-only" : "ui-glyph-label"}>
        {label}
      </span>
    </span>
  );
}
