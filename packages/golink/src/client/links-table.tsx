import { CheckIcon, CopyIcon, CornerDownRightIcon } from "lucide-react";
import { Button, IconButton } from "@shepherdjerred/console-ui";
import type { LinkItem } from "#shared/contract.ts";
import {
  describeDynamicKind,
  describeLinkKind,
  sourceIcon,
} from "./directory-sections.tsx";

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
    return <span className="ui-muted">Read-only</span>;
  }
  if (item.kind === "manual") {
    return (
      <div className="golink-row-actions">
        <Button
          className="golink-row-btn"
          aria-label={`Edit go/${item.short}`}
          onClick={() => {
            onEdit(item);
          }}
        >
          Edit
        </Button>
        <Button
          className="golink-row-btn golink-danger"
          aria-label={`Delete go/${item.short}`}
          disabled={isDeleting}
          onClick={() => {
            onDelete(item);
          }}
        >
          {isDeleting ? "Deleting…" : "Delete"}
        </Button>
      </div>
    );
  }
  return (
    <div className="golink-row-actions">
      <Button
        className="golink-row-btn"
        aria-label={`Override go/${item.short}`}
        onClick={() => {
          onOverride(item);
        }}
      >
        Override
      </Button>
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
  const hasDetail = item.detail !== undefined && item.detail.length > 0;
  const SourceIcon = sourceIcon(item.kind);

  return (
    <tr>
      <th scope="row" data-label="Shortlink">
        <div className="golink-shortlink">
          <a
            href={`/${encodeURIComponent(item.short)}`}
            className="ui-mono ui-strong"
          >
            go/{item.short}
          </a>
          <IconButton
            icon={isCopied ? CheckIcon : CopyIcon}
            label={
              isCopied ? `Copied go/${item.short}` : `Copy go/${item.short} URL`
            }
            className="golink-copy"
            onClick={() => {
              onCopy(item.short);
            }}
          />
        </div>
      </th>

      <td className="golink-dest-cell" data-label="Destination">
        <a
          href={item.targetUrl}
          className="golink-dest ui-mono"
          title={item.targetUrl}
          rel="noreferrer"
        >
          {item.targetUrl}
        </a>
        {item.shadows !== undefined && (
          <p className="golink-shadow ui-muted" title={item.shadows.targetUrl}>
            <CornerDownRightIcon aria-hidden />
            <span>
              Overrides {describeDynamicKind(item.shadows.kind)}:{" "}
              <span className="ui-mono">{item.shadows.targetUrl}</span>
            </span>
          </p>
        )}
      </td>

      <td data-label="Source">
        <span className="golink-source">
          <SourceIcon aria-hidden />
          <span>{describeLinkKind(item.kind)}</span>
        </span>
        {hasDetail && (
          <span className="golink-detail ui-muted" title={item.detail}>
            {item.detail}
          </span>
        )}
      </td>

      <td
        className="ui-num"
        data-label="Usage"
        title={
          item.createdBy === undefined || item.createdBy.length === 0
            ? undefined
            : `Created by ${item.createdBy}`
        }
      >
        {item.kind === "manual" ? (
          <>
            <span className="ui-mono">{String(item.clicks ?? 0)}</span>
            <span className="golink-detail ui-muted">
              {formatLastClicked(item.lastClickedAt)}
            </span>
          </>
        ) : (
          <span className="ui-muted" aria-label="Not tracked for dynamic link">
            —
          </span>
        )}
      </td>

      <td data-label="Actions" className="golink-actions-cell">
        <RowActionsCell
          item={item}
          writesEnabled={writesEnabled}
          isDeleting={deletingShort === item.short}
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
    <section aria-labelledby="links-heading" className="golink-table-wrap">
      <div className="ui-section-head">
        <h2 className="ui-section-title" id="links-heading">
          Routes
        </h2>
        <span className="ui-count">
          {String(items.length)} of {String(totalCount)}
        </span>
      </div>
      <div className="ui-table-scroll">
        <table className="ui-table golink-links">
          <thead>
            <tr>
              <th scope="col">Shortlink</th>
              <th scope="col">Destination</th>
              <th scope="col">Source</th>
              <th scope="col" className="ui-num">
                Clicks
              </th>
              <th scope="col">
                <span className="ui-sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="golink-empty">
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
