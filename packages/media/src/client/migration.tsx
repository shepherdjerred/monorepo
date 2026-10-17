import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import type { MediaUser } from "#shared/contract.ts";
import {
  MAX_MIGRATION_BYTES,
  MigrationProposalListSchema,
  MigrationProposalSchema,
  MigrationSnapshotSchema,
  type MigrationRecord,
} from "#shared/migration.ts";
import { CommandResultSchema } from "#shared/api.ts";
import { readApi, writeApi, queryClient } from "./api.ts";
import { ErrorNotice, Loading } from "./components.tsx";
import "./migration.css";
import { MigrationBundles } from "./migration-bundle.tsx";
import { MigrationDiscovery } from "./migration-discovery.tsx";

type Proposal = z.infer<typeof MigrationProposalSchema>;
export function MigrationPage({ user }: { user: MediaUser }) {
  const [file, setFile] = useState<File | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const proposals = useQuery({
    queryKey: ["migration"],
    queryFn: async () =>
      readApi("/admin/migration", MigrationProposalListSchema),
  });
  const upload = useMutation({
    mutationFn: async () => {
      if (file === null) throw new Error("Choose a sanitized capture file");
      if (file.size > MAX_MIGRATION_BYTES)
        throw new Error("Capture exceeds the 24 MiB limit");
      const value: unknown = JSON.parse(await file.text());
      const envelope = z
        .object({ snapshot: MigrationSnapshotSchema })
        .safeParse(value);
      const snapshot = envelope.success
        ? envelope.data.snapshot
        : MigrationSnapshotSchema.parse(value);
      return await writeApi({
        actorId: user.id,
        path: "/admin/migration",
        body: { snapshot },
        schema: MigrationProposalSchema,
        sensitive: true,
      });
    },
    onSuccess: async (proposal) => {
      setSelected(proposal.id);
      await queryClient.invalidateQueries({ queryKey: ["migration"] });
    },
  });
  return (
    <section className="migration-page">
      <header className="page-title">
        <p className="eyebrow">OWNER WORKSPACE</p>
        <h1>Bring your library over.</h1>
        <p>
          Review a read-only capture from your existing managers. Every source
          record stays unowned until a separate verified handoff.
        </p>
      </header>
      <div className="notice">
        Approval saves your review. It does not pause another manager, adopt
        files, change torrents, or enable automation. Protected entries require
        more evidence.
      </div>
      <section className="panel">
        <h2>Upload a capture</h2>
        <p>
          Use the migration inventory CLI to produce sanitized JSON.
          Credentials, private download links, and contact details are rejected
          by the capture contract.
        </p>
        <form
          className="stack-form"
          onSubmit={(event) => {
            event.preventDefault();
            upload.mutate();
          }}
        >
          <label>
            Capture JSON
            <input
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                setFile(event.currentTarget.files?.[0] ?? null);
              }}
            />
          </label>
          <button
            className="button primary"
            type="submit"
            disabled={file === null || upload.isPending}
          >
            {upload.isPending ? "Checking capture…" : "Upload and compare"}
          </button>
        </form>
        {upload.error !== null && <ErrorNotice error={upload.error} />}
        {upload.isSuccess && (
          <p role="status">Capture saved. Review the comparison below.</p>
        )}
      </section>
      {proposals.isPending && <Loading />}
      {proposals.error !== null && <ErrorNotice error={proposals.error} />}
      {proposals.data?.length === 0 && (
        <p>No captures yet. Existing library ownership is unchanged.</p>
      )}
      {proposals.data?.map((proposal) => (
        <button
          className="button"
          key={proposal.id}
          onClick={() => {
            setSelected(proposal.id);
          }}
        >
          {proposal.source.kind} ·{" "}
          {new Date(proposal.createdAt).toLocaleString()} ·{" "}
          {proposal.status.replaceAll("_", " ")}
        </button>
      ))}
      {selected !== null && (
        <ProposalDetail key={selected} id={selected} user={user} />
      )}
      {proposals.data !== undefined && (
        <MigrationBundles captures={proposals.data} actorId={user.id} />
      )}
    </section>
  );
}
function ProposalDetail({ id, user }: { id: string; user: MediaUser }) {
  const detail = useQuery({
    queryKey: ["migration", id],
    queryFn: async () =>
      readApi(`/admin/migration/${id}`, MigrationProposalSchema),
  });
  if (detail.isPending) return <Loading />;
  if (detail.error !== null) return <ErrorNotice error={detail.error} />;
  return (
    <ProposalReview
      key={`${id}:${String(detail.data.version)}`}
      proposal={detail.data}
      user={user}
    />
  );
}
function ProposalReview({
  proposal,
  user,
}: {
  proposal: Proposal;
  user: MediaUser;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [page, setPage] = useState(0);
  const review = useMutation({
    mutationFn: async (action: "approve" | "revoke") =>
      writeApi({
        actorId: user.id,
        path: `/admin/migration/${proposal.id}/review`,
        body: {
          action,
          expectedVersion: proposal.version,
          reportHash: proposal.reportHash,
          captureHash: proposal.captureHash,
          recoveryEpoch: proposal.recoveryEpoch,
          runtimeVersion: proposal.runtimeVersion,
          acknowledgeNoOwnershipTransfer: true,
        },
        schema: CommandResultSchema,
      }),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["migration"] }),
  });
  const protectedCount = proposal.report.entries.filter(
    (entry) => entry.state !== "adoptable_evidence_ready",
  ).length;
  const rows = proposal.report.entries.slice(page * 50, (page + 1) * 50);
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>{new Date(proposal.createdAt).toLocaleString()}</h2>
        <span className="badge">{proposal.status.replaceAll("_", " ")}</span>
      </div>
      <p>
        <Link
          to={`/recovery?captureId=${encodeURIComponent(proposal.captureId)}`}
        >
          Associate captured requesters with exact household identities
        </Link>
        . Identity association alone creates no demand or ownership.
      </p>
      <p>
        <strong>{proposal.source.kind}</strong> · Version{" "}
        {proposal.source.version}
      </p>
      <p className="helper">
        Source instance <code>{proposal.source.instanceId}</code>
      </p>
      <MigrationDiscovery proposal={proposal} actorId={user.id} />
      <p>
        {proposal.report.entries.length} records · {protectedCount} protected ·{" "}
        {proposal.report.complete && proposal.report.stable
          ? "Complete and stable capture"
          : "Incomplete or changing source"}
      </p>
      <details>
        <summary>Evidence fingerprints</summary>
        <p>
          Capture: <code>{proposal.captureHash}</code>
        </p>
        <p>
          Report: <code>{proposal.reportHash}</code>
        </p>
        <p>
          Recovery epoch {proposal.recoveryEpoch} · Runtime version{" "}
          {proposal.runtimeVersion}
        </p>
      </details>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Source record</th>
              <th>Evidence</th>
              <th>Review status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => (
              <tr key={entry.provenanceKey}>
                <td>
                  {entry.kind.replaceAll("_", " ")} · {entry.sourceId}
                  <SourceContext record={entry.sourceRecord} />
                  {entry.mappedMedia.length === 0 ? (
                    <p>No destination mapping</p>
                  ) : (
                    <ul>
                      {entry.mappedMedia.map((media) => (
                        <li key={media.mediaId}>
                          <Link to={`/media/${media.mediaId}`}>
                            {media.title ?? media.mediaId}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td>
                  {entry.confidence}
                  <br />
                  {entry.reasons
                    .map((reason) => reason.replaceAll("_", " "))
                    .join(", ") || "Ready for a separately verified handoff"}
                </td>
                <td>
                  {entry.state.replaceAll("_", " ")}
                  <br />
                  Unowned
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {proposal.report.entries.length > 50 && (
        <div className="actions">
          <button
            className="button"
            disabled={page === 0}
            onClick={() => {
              setPage(page - 1);
            }}
          >
            Previous records
          </button>
          <button
            className="button"
            disabled={(page + 1) * 50 >= proposal.report.entries.length}
            onClick={() => {
              setPage(page + 1);
            }}
          >
            Next records
          </button>
        </div>
      )}
      {proposal.status === "awaiting_review" && (
        <>
          <label className="review-choice">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => {
                setAcknowledged(event.currentTarget.checked);
              }}
            />{" "}
            I reviewed this evidence and understand this does not transfer
            ownership.
          </label>
          <button
            className="button primary"
            disabled={!acknowledged || review.isPending}
            onClick={() => {
              review.mutate("approve");
            }}
          >
            Record approval
          </button>
        </>
      )}
      {proposal.status === "approved" && (
        <button
          className="button"
          disabled={review.isPending}
          onClick={() => {
            review.mutate("revoke");
          }}
        >
          Revoke approval
        </button>
      )}
      {review.error !== null && <ErrorNotice error={review.error} />}
    </section>
  );
}
function SourceContext({ record }: { record: MigrationRecord }) {
  if (record.kind === "media" || record.kind === "request")
    return (
      <p>
        {Object.entries(record.externalIds)
          .map(([kind, id]) => `${kind}: ${String(id)}`)
          .join(" · ") || "External identity missing"}
        {record.kind === "media" && record.season !== null
          ? ` · Season ${String(record.season)} episode ${String(record.episode)}`
          : ""}
      </p>
    );
  if (record.kind === "file" || record.kind === "subtitle")
    return (
      <p>
        <code>{record.path}</code>
        {record.kind === "file"
          ? ` · ${String(record.mediaSourceIds.length)} source media item(s)`
          : ` · ${record.language}`}
      </p>
    );
  return record.kind === "subtitle_preference" ? (
    <p>
      Source media {record.mediaSourceId} · {record.languages.join(", ")}
    </p>
  ) : (
    <p>
      Wire ID <code>{record.wireId}</code>
      <br />
      v1 <code>{record.infoHashV1 ?? "Absent"}</code>
      <br />
      v2 <code>{record.infoHashV2 ?? "Absent"}</code>
      <br />
      <code>{record.savePath}</code>
    </p>
  );
}
