import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import {
  BundleReviewSchema,
  BundleReviewListSchema,
} from "#shared/migration-handoff.ts";
import type { MigrationProposalListSchema } from "#shared/migration.ts";
import { CommandResultSchema } from "#shared/api.ts";
import { readApi, writeApi, queryClient } from "./api.ts";
import { ErrorNotice, Loading } from "./components.tsx";

export function MigrationBundles({
  captures,
  actorId,
}: {
  captures: z.infer<typeof MigrationProposalListSchema>;
  actorId: string;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const summaries = useQuery({
    queryKey: ["migration", "bundles"],
    queryFn: async () =>
      readApi("/admin/migration/bundles", BundleReviewListSchema),
  });
  const create = useMutation({
    mutationFn: async () =>
      writeApi({
        actorId,
        path: "/admin/migration/bundles",
        body: { captureIds: selected },
        schema: BundleReviewSchema,
      }),
    onSuccess: async (result) => {
      setReviewId(result.id);
      await queryClient.invalidateQueries({
        queryKey: ["migration", "bundles"],
      });
    },
  });
  const distinct = [
    ...new Map(
      captures.map((capture) => [capture.captureId, capture]),
    ).values(),
  ];
  return (
    <section className="panel">
      <h2>Review the complete handoff set</h2>
      <p>
        Choose one stable capture per source instance: Radarr, Sonarr, Seerr,
        Bazarr and qBittorrent. A partial set stays protected. This review
        cannot activate automation.
      </p>
      <fieldset>
        <legend>Immutable source captures</legend>
        {distinct.map((capture) => (
          <label className="checkbox-row" key={capture.captureId}>
            <input
              type="checkbox"
              checked={selected.includes(capture.captureId)}
              onChange={(event) => {
                setSelected(
                  event.target.checked
                    ? [...selected, capture.captureId]
                    : selected.filter((id) => id !== capture.captureId),
                );
              }}
            />
            {capture.source.kind} {capture.source.version} ·{" "}
            {new Date(capture.createdAt).toLocaleString()} ·{" "}
            {capture.captureHash.slice(0, 12)}
          </label>
        ))}
      </fieldset>
      <button
        className="button primary"
        disabled={selected.length === 0 || create.isPending}
        onClick={() => {
          create.mutate();
        }}
      >
        {create.isPending ? "Comparing sources…" : "Build combined report"}
      </button>
      {create.error !== null && <ErrorNotice error={create.error} />}
      {summaries.error !== null && <ErrorNotice error={summaries.error} />}
      <div className="action-row">
        {summaries.data?.map((review) => (
          <button
            className="button"
            key={review.id}
            onClick={() => {
              setReviewId(review.id);
            }}
          >
            {review.status.replaceAll("_", " ")} ·{" "}
            {review.reportHash.slice(0, 12)}
          </button>
        ))}
      </div>
      {reviewId !== null && (
        <BundleDetail key={reviewId} id={reviewId} actorId={actorId} />
      )}
    </section>
  );
}
function BundleDetail({ id, actorId }: { id: string; actorId: string }) {
  const detail = useQuery({
    queryKey: ["migration", "bundles", id],
    queryFn: async () =>
      readApi(`/admin/migration/bundles/${id}`, BundleReviewSchema),
  });
  if (detail.isPending) return <Loading />;
  if (detail.error !== null) return <ErrorNotice error={detail.error} />;
  return (
    <BundleSelection
      key={`${id}:${String(detail.data.version)}`}
      review={detail.data}
      actorId={actorId}
    />
  );
}
function BundleSelection({
  review,
  actorId,
}: {
  review: z.infer<typeof BundleReviewSchema>;
  actorId: string;
}) {
  const [selected, setSelected] = useState(
    review.selection.map((item) => item.provenanceKey),
  );
  const [acknowledged, setAcknowledged] = useState(false);
  const [page, setPage] = useState(0);
  const mutation = useMutation({
    mutationFn: async (action: "approve" | "revoke") =>
      writeApi({
        actorId,
        path: `/admin/migration/bundles/${review.id}/review`,
        schema: CommandResultSchema,
        body: {
          action,
          expectedVersion: review.version,
          reportHash: review.report.reportHash,
          bundleHash: review.manifest.bundleHash,
          recoveryEpoch: review.recoveryEpoch,
          runtimeVersion: review.runtimeVersion,
          acknowledgeNoOwnershipTransfer: true,
          selected: review.report.entries
            .filter((entry) => selected.includes(entry.provenanceKey))
            .map((entry) => ({
              provenanceKey: entry.provenanceKey,
              evidenceHash: entry.observationHash,
            })),
        },
      }),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["migration", "bundles"] }),
  });
  return (
    <section>
      <h3>
        {review.status.replaceAll("_", " ")} · {review.report.entries.length}{" "}
        source records
      </h3>
      <p>
        {review.manifest.complete && review.manifest.stable
          ? "Complete, stable source set."
          : "Protected: source roles are missing or observations changed."}{" "}
        Files still require fresh mount identity, checksum and manager handoff
        proof. Nothing is owned by this application.
      </p>
      <details>
        <summary>Review fingerprints and source bindings</summary>
        <p>
          Bundle <code>{review.manifest.bundleHash}</code>
        </p>
        <p>
          Report <code>{review.report.reportHash}</code>
        </p>
        <p>
          Recovery epoch {review.recoveryEpoch} · Runtime version{" "}
          {review.runtimeVersion}
        </p>
        <ul>
          {review.manifest.captures.map((capture) => (
            <li key={capture.captureId}>
              {capture.sourceKind}: <code>{capture.captureHash}</code>
            </li>
          ))}
        </ul>
      </details>
      <div className="migration-table-wrap">
        <table className="migration-table">
          <thead>
            <tr>
              <th>Select</th>
              <th>Source / destination</th>
              <th>Review status</th>
            </tr>
          </thead>
          <tbody>
            {review.report.entries
              .slice(page * 50, (page + 1) * 50)
              .map((entry) => (
                <tr key={entry.provenanceKey}>
                  <td>
                    <input
                      aria-label={`Select ${entry.kind} ${entry.sourceId}`}
                      type="checkbox"
                      disabled={
                        entry.state !== "adoptable_evidence_ready" ||
                        review.status === "approved"
                      }
                      checked={selected.includes(entry.provenanceKey)}
                      onChange={(event) => {
                        setSelected(
                          event.target.checked
                            ? [...selected, entry.provenanceKey]
                            : selected.filter(
                                (id) => id !== entry.provenanceKey,
                              ),
                        );
                      }}
                    />
                  </td>
                  <td>
                    {entry.kind} · {entry.sourceId}
                    <br />
                    {entry.mappedMedia
                      .map((media) => media.title ?? media.mediaId)
                      .join(", ") || "Unmapped"}
                    {entry.sourceRecord.kind === "file" && (
                      <p>
                        <code>{entry.sourceRecord.path}</code>
                      </p>
                    )}
                  </td>
                  <td>
                    {entry.state.replaceAll("_", " ")}
                    <br />
                    {entry.reasons
                      .map((reason) => reason.replaceAll("_", " "))
                      .join("; ")}
                    <br />
                    Unowned
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="action-row">
        <button
          className="button"
          disabled={page === 0}
          onClick={() => {
            setPage(page - 1);
          }}
        >
          Previous
        </button>
        <button
          className="button"
          disabled={(page + 1) * 50 >= review.report.entries.length}
          onClick={() => {
            setPage(page + 1);
          }}
        >
          Next
        </button>
      </div>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => {
            setAcknowledged(event.target.checked);
          }}
        />
        I understand that approval only records this selection and does not
        transfer ownership.
      </label>
      <button
        className="button primary"
        disabled={
          !acknowledged ||
          mutation.isPending ||
          review.status === "protected" ||
          (review.status !== "approved" && selected.length === 0)
        }
        onClick={() => {
          mutation.mutate(review.status === "approved" ? "revoke" : "approve");
        }}
      >
        {review.status === "approved"
          ? "Revoke selection approval"
          : "Record selection approval"}
      </button>
      {mutation.error !== null && <ErrorNotice error={mutation.error} />}
    </section>
  );
}
