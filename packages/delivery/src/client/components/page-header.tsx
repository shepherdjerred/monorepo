import type { ReactNode } from "react";

/**
 * The route's single h1. Client navigations move focus here so screen readers
 * announce the new page; the document title follows the heading.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <title>{`${title} · Delivery`}</title>
      <div>
        {eyebrow !== undefined && <p className="eyebrow">{eyebrow}</p>}
        <h1 id="main-heading" tabIndex={-1}>
          {title}
        </h1>
        {description !== undefined && <p className="subtitle">{description}</p>}
      </div>
      {actions !== undefined && <div className="header-actions">{actions}</div>}
    </header>
  );
}
