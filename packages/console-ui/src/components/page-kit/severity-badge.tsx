import { clsx } from "clsx";
import type { LucideIcon } from "lucide-react";
import {
  SEVERITY_ICON,
  SEVERITY_LABEL,
} from "@shepherdjerred/console-ui/components/status-glyph.tsx";
import type { Severity } from "@shepherdjerred/console-ui/tokens.ts";

export type SeverityBadgeProps = {
  readonly severity: Severity;
  /** Defaults to the severity's name ("Warning"); pass e.g. "Critical" to rename. */
  readonly label?: string;
  /** `large` suits a page verdict beside a `PageHeading`. */
  readonly size?: "default" | "large";
  /**
   * Replaces the severity's own glyph, e.g. a minus for an "Off" state shown
   * as `unknown`. The glyph stays decorative: the label carries the meaning.
   */
  readonly icon?: LucideIcon;
};

/**
 * An uppercase pill tinted with the severity's soft colour: a glyph plus its
 * word, so severity never rests on colour alone.
 *
 * @deprecated Use `StatusGlyph` (glyph plus word; `icon` swaps the glyph).
 */
export function SeverityBadge({
  severity,
  label = SEVERITY_LABEL[severity],
  size = "default",
  icon,
}: SeverityBadgeProps): React.JSX.Element {
  const Icon = icon ?? SEVERITY_ICON[severity];
  return (
    <span
      className={clsx("ui-badge", size === "large" && "ui-badge-large")}
      data-sev={severity}
    >
      <Icon className="ui-badge-icon" aria-hidden="true" />
      {label}
    </span>
  );
}
