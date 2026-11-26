import { CheckIcon, CopyIcon, CornerDownRightIcon } from "lucide-react";
import { Button, IconButton, Tag } from "@shepherdjerred/console-ui";
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
          size="page"
          aria-label={`Edit go/${item.short}`}
          onClick={() => {
            onEdit(item);
          }}
        >
          Edit
        </Button>
        <Button
          size="page"
          className="golink-danger"
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
        size="page"
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
            className="golink-short"
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
        <div className="golink-cell">
          <a
            href={item.targetUrl}
            className="golink-dest"
            title={item.targetUrl}
            rel="noreferrer"
          >
            {item.targetUrl}
          </a>
          {item.shadows !== undefined && (
            <p
              className="golink-shadow ui-muted"
              title={item.shadows.targetUrl}
            >
              <CornerDownRightIcon aria-hidden />
              <span>
                Overrides {describeDynamicKind(item.shadows.kind)}:{" "}
                {item.shadows.targetUrl}
              </span>
            </p>
          )}
        </div>
      </td>

      <td data-label="Source">
        <Tag title={hasDetail ? item.detail : undefined}>
          <SourceIcon aria-hidden />
          {describeLinkKind(item.kind)}
        </Tag>
      </td>

      <td
        className="ui-num"
        data-label="Clicks"
        title={
          item.createdBy === undefined || item.createdBy.length === 0
            ? undefined
            : `Created by ${item.createdBy}`
        }
      >
        {item.kind === "manual" ? (
          <div className="golink-cell">
            <span className="golink-clicks">{String(item.clicks ?? 0)}</span>
            <span className="golink-detail ui-muted">
              {formatLastClicked(item.lastClickedAt)}
            </span>
          </div>
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
  if (items.length === 0) {
    return (
      <p className="ui-state">
        {totalCount === 0
          ? "No shortlinks yet."
          : "No shortlinks match the current filter."}
      </p>
    );
  }
  return (
    <div className="ui-data-scroll">
      <table className="ui-data golink-links">
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
          {items.map((item) => (
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
