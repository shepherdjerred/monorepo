import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import type { z } from "zod";
import type {
  MigrationRecord,
  MigrationReportEntrySchema,
} from "#shared/migration.ts";
import { Badge } from "#client/ui/feedback.tsx";
import { DataList, DataRow } from "#client/ui/data-list.tsx";
import { EmptyNote } from "#client/ui/panel.tsx";
import { Code, Pager } from "#client/ui/workflow.tsx";
import {
  CONFIDENCE,
  ENTRY_STATE,
  RECORD_KINDS,
  reasonLabel,
} from "./vocabulary.ts";

export type ReportEntry = z.infer<typeof MigrationReportEntrySchema>;

/** What the source said about one record, in the words a person would use. */
function SourceContext({ record }: { record: MigrationRecord }) {
  if (record.kind === "media" || record.kind === "request") {
    const ids = Object.entries(record.externalIds)
      .map(([kind, id]) => `${kind}: ${String(id)}`)
      .join(", ");
    const episode =
      record.kind === "media" && record.season !== null
        ? `Season ${String(record.season)} episode ${String(record.episode)}`
        : null;
    return (
      <p>
        {ids === "" ? "External identity missing" : ids}
        {episode === null ? "" : `. ${episode}`}
      </p>
    );
  }
  if (record.kind === "file" || record.kind === "subtitle") {
    return (
      <p>
        <Code>{record.path}</Code>
        {record.kind === "file"
          ? ` (${String(record.mediaSourceIds.length)} source media item${record.mediaSourceIds.length === 1 ? "" : "s"})`
          : ` (${record.language})`}
      </p>
    );
  }
  if (record.kind === "subtitle_preference") {
    return (
      <p>
        Source media {record.mediaSourceId}, {record.languages.join(", ")}
      </p>
    );
  }
  return (
    <>
      <p>
        Wire ID <Code>{record.wireId}</Code>
      </p>
      <p>
        Version 1 hash <Code>{record.infoHashV1 ?? "Absent"}</Code>
      </p>
      <p>
        Version 2 hash <Code>{record.infoHashV2 ?? "Absent"}</Code>
      </p>
      <p>
        Saved at <Code>{record.savePath}</Code>
      </p>
    </>
  );
}

/**
 * One captured record: what it is, the titles it maps to, the evidence for
 * that, and that nothing about it is owned yet.
 */
export function RecordRow({
  entry,
  name,
  note = "No reasons to hold this back.",
}: {
  entry: ReportEntry;
  /** Replaces the plain name, for a row that can be picked. */
  name?: ReactNode;
  /** What is said when the record has no reasons. */
  note?: string;
}) {
  const state = ENTRY_STATE[entry.state];
  const confidence = CONFIDENCE[entry.confidence];
  const label = recordName(entry);
  return (
    <DataRow
      title={name ?? label}
      detail={
        <>
          <SourceContext record={entry.sourceRecord} />
          {entry.mappedMedia.length === 0 ? (
            <p>No destination title.</p>
          ) : (
            <p>
              {entry.mappedMedia.map((media, index) => (
                <span key={media.mediaId}>
                  {index === 0 ? "" : ", "}
                  <Link to={`/media/${media.mediaId}`}>
                    {media.title ?? media.mediaId}
                  </Link>
                </span>
              ))}
            </p>
          )}
          <p>
            {entry.reasons.length === 0
              ? note
              : entry.reasons.map((reason) => reasonLabel(reason)).join(". ")}
          </p>
        </>
      }
      status={
        <>
          <Badge tone={confidence.tone}>{confidence.label}</Badge>
          <Badge tone={state.tone}>{state.label}</Badge>
        </>
      }
    />
  );
}

/** The kind and source name a row is called by. */
export function recordName(entry: ReportEntry): string {
  return `${RECORD_KINDS[entry.kind]} ${entry.sourceId}`;
}

const PAGE_SIZE = 50;

/** Captured records, fifty to a page. */
export function RecordList({
  entries,
  label,
  empty,
  row,
}: {
  entries: readonly ReportEntry[];
  /** Names the list for assistive technology. */
  label: string;
  /** What is said when there are none. */
  empty: string;
  row: (entry: ReportEntry) => ReactNode;
}) {
  const [page, setPage] = useState(0);
  if (entries.length === 0) return <EmptyNote>{empty}</EmptyNote>;
  const last = (page + 1) * PAGE_SIZE >= entries.length;
  return (
    <>
      <DataList label={label}>
        {entries
          .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
          .map((entry) => row(entry))}
      </DataList>
      {entries.length > PAGE_SIZE && (
        <Pager
          what="records"
          from={page * PAGE_SIZE + 1}
          to={Math.min((page + 1) * PAGE_SIZE, entries.length)}
          total={entries.length}
          onPrevious={
            page === 0
              ? null
              : () => {
                  setPage(page - 1);
                }
          }
          onNext={
            last
              ? null
              : () => {
                  setPage(page + 1);
                }
          }
        />
      )}
    </>
  );
}
