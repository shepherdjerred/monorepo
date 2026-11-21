import type { LinkItem, LinkKind } from "#shared/contract.ts";
import {
  describeDynamicKind,
  describeLinkKind,
} from "./directory-sections.tsx";

function sourceIconGlyph(kind: LinkKind): string {
  switch (kind) {
    case "manual": {
      return "◆";
    }
    case "ingress": {
      return "⇄";
    }
    case "site": {
      return "◎";
    }
    case "alias": {
      return "↳";
    }
    case "shortcut": {
      return "⌘";
    }
  }
}

function formatLastClicked(iso: string | null | undefined): string {
  if (iso === undefined || iso === null || iso.length === 0) {
    return "Never clicked";
  }
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) {
    return iso;
  }
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  });
  return `Last ${formatter.format(new Date(timestamp))}`;
}

function formatClickCount(count = 0): string {
  return count === 1 ? "1 click" : `${String(count)} clicks`;
}

function RowActionsCell({
  item,
  writesEnabled,
  isDeleting,
  onEdit,
  onOverride,
  onDelete,
}: {
  item: LinkItem;
  writesEnabled: boolean;
  isDeleting: boolean;
  onEdit: (item: LinkItem) => void;
  onOverride: (item: LinkItem) => void;
  onDelete: (item: LinkItem) => void;
}) {
  if (!writesEnabled) {
    return <span className="usage-dash">Read-only</span>;
  }
  if (item.kind === "manual") {
    return (
      <div className="row-actions">
        <button
          type="button"
          className="btn btn-secondary btn-row"
          onClick={() => {
            onEdit(item);
          }}
        >
          Edit
        </button>
        <button
          type="button"
          className="btn btn-danger-outline btn-row"
          disabled={isDeleting}
          onClick={() => {
            onDelete(item);
          }}
        >
          {isDeleting ? "Deleting…" : "Delete"}
        </button>
      </div>
    );
  }
  return (
    <div className="row-actions">
      <button
        type="button"
        className="btn btn-secondary btn-row"
        onClick={() => {
          onOverride(item);
        }}
      >
        Override
      </button>
    </div>
  );
}

function LinkTableRow({
  item,
  writesEnabled,
  copiedShort,
  deletingShort,
  onCopy,
  onEdit,
  onOverride,
  onDelete,
}: {
  item: LinkItem;
  writesEnabled: boolean;
  copiedShort: string | null;
  deletingShort: string | null;
  onCopy: (short: string) => void;
  onEdit: (item: LinkItem) => void;
  onOverride: (item: LinkItem) => void;
  onDelete: (item: LinkItem) => void;
}) {
  const isCopied = copiedShort === item.short;
  const isDeleting = deletingShort === item.short;
  const hasDetail = item.detail !== undefined && item.detail.length > 0;
  const hasAuthor = item.createdBy !== undefined && item.createdBy.length > 0;

  return (
    <tr>
      <th scope="row">
        <div className="shortlink-cell">
          <a
            href={`/${encodeURIComponent(item.short)}`}
            className="shortlink-anchor"
          >
            <span className="shortlink-prefix">go/</span>
            <span>{item.short}</span>
          </a>
          <button
            type="button"
            className="btn-inline copy-btn"
            aria-label={
              isCopied ? `Copied go/${item.short}` : `Copy go/${item.short} URL`
            }
            onClick={() => {
              onCopy(item.short);
            }}
          >
            {isCopied ? "✓ Copied" : "Copy"}
          </button>
        </div>
      </th>

      <td>
        <div className="destination-cell">
          <a
            href={item.targetUrl}
            className="destination-link"
            rel="noreferrer"
          >
            {item.targetUrl}
          </a>
          {item.shadows !== undefined && (
            <p className="shadow-note">
              <span aria-hidden="true">↳ </span>
              Overrides {describeDynamicKind(item.shadows.kind)}:{" "}
              <code>{item.shadows.targetUrl}</code>
            </p>
          )}
        </div>
      </td>

      <td>
        <div className="source-cell">
          <span className={`source-badge source-badge-${item.kind}`}>
            <span aria-hidden="true">{sourceIconGlyph(item.kind)}</span>
            <span>{describeLinkKind(item.kind)}</span>
          </span>
          {hasDetail && <span className="source-detail">{item.detail}</span>}
        </div>
      </td>

      <td>
        {item.kind === "manual" ? (
          <div className="usage-cell">
            <span className="usage-primary">
              {formatClickCount(item.clicks)} ·{" "}
              {formatLastClicked(item.lastClickedAt)}
            </span>
            {hasAuthor && (
              <span className="usage-secondary">by {item.createdBy}</span>
            )}
          </div>
        ) : (
          <span
            className="usage-dash"
            aria-label="Not tracked for dynamic link"
          >
            —
          </span>
        )}
      </td>

      <td>
        <RowActionsCell
          item={item}
          writesEnabled={writesEnabled}
          isDeleting={isDeleting}
          onEdit={onEdit}
          onOverride={onOverride}
          onDelete={onDelete}
        />
      </td>
    </tr>
  );
}

export function LinksTable({
  items,
  totalCount,
  writesEnabled,
  copiedShort,
  deletingShort,
  onCopy,
  onEdit,
  onOverride,
  onDelete,
}: {
  items: readonly LinkItem[];
  totalCount: number;
  writesEnabled: boolean;
  copiedShort: string | null;
  deletingShort: string | null;
  onCopy: (short: string) => void;
  onEdit: (item: LinkItem) => void;
  onOverride: (item: LinkItem) => void;
  onDelete: (item: LinkItem) => void;
}) {
  return (
    <section className="table-card">
      <div
        tabIndex={0}
        role="region"
        aria-labelledby="links-table-caption"
        className="table-wrapper"
      >
        <table className="links-table">
          <caption id="links-table-caption">
            <span>Active go/ routes</span>
            <span className="caption-count">
              Showing {String(items.length)} of {String(totalCount)}
            </span>
          </caption>
          <thead>
            <tr>
              <th scope="col">Shortlink</th>
              <th scope="col">Destination</th>
              <th scope="col">Source</th>
              <th scope="col">Usage</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={5} className="empty-cell">
                  No shortlinks match the current filter.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <LinkTableRow
                  key={item.short}
                  item={item}
                  writesEnabled={writesEnabled}
                  copiedShort={copiedShort}
                  deletingShort={deletingShort}
                  onCopy={onCopy}
                  onEdit={onEdit}
                  onOverride={onOverride}
                  onDelete={onDelete}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
