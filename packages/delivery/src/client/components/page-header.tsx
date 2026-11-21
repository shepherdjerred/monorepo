import type { ReactNode } from "react";

/** The eyebrow every top-level section of the app shares. */
export const SECTION_EYEBROW = "Homelab CI/CD";

/** A stable ref callback, so React focuses the heading once, when it mounts. */
function focusHeading(node: HTMLHeadingElement | null) {
  node?.focus();
}

/**
 * The route's single h1. Client navigations move focus here so screen readers
 * announce the new page; the document title follows the heading. A page that
 * replaces what was asked for, such as an error, takes focus itself.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  takeFocus = false,
}: {
  eyebrow?: ReactNode;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  takeFocus?: boolean;
}) {
  return (
    <header className="page-header">
      <title>{`${title} · Delivery`}</title>
      <div>
        {eyebrow !== undefined && <p className="eyebrow">{eyebrow}</p>}
        <h1
          id="main-heading"
          tabIndex={-1}
          ref={takeFocus ? focusHeading : undefined}
        >
          {title}
        </h1>
        {description !== undefined && <p className="subtitle">{description}</p>}
      </div>
      {actions !== undefined && <div className="header-actions">{actions}</div>}
    </header>
  );
}
