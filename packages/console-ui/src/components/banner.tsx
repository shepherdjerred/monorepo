import type { ReactNode } from "react";
import { StatusGlyph } from "@shepherdjerred/console-ui/components/status-glyph.tsx";
import type { Severity } from "@shepherdjerred/console-ui/tokens.ts";

export type BannerProps = {
  readonly severity: Severity;
  /** The severity word; defaults to the severity's name ("Warning"). */
  readonly label?: string;
  /** What happened and what to do, in a sentence or two. */
  readonly children: ReactNode;
  /** Buttons at the end of the row, e.g. Retry. */
  readonly actions?: ReactNode;
  /**
   * `status` or `alert` makes the banner a live region, for banners that
   * appear after the page has loaded.
   */
  readonly role?: "status" | "alert";
};

/**
 * A quiet full-bleed row for page-level news: glyph, severity word, text,
 * actions. Place it right under the header bar or a section head.
 */
export function Banner({
  severity,
  label,
  children,
  actions,
  role,
}: BannerProps): React.JSX.Element {
  return (
    <div className="ui-banner" data-sev={severity} role={role}>
      <StatusGlyph severity={severity} label={label} />
      <div className="ui-banner-text">{children}</div>
      {actions === undefined ? null : (
        <div className="ui-banner-actions">{actions}</div>
      )}
    </div>
  );
}
