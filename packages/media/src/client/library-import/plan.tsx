import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { HandoffDetailSchema } from "#shared/handoff.ts";
import { HandoffScopeProtocolSchema } from "#shared/handoff/protocol.ts";
import {
  ApplyLibraryHandoffV3Schema,
  FinishedLibraryHandoffV3Schema,
} from "#shared/handoff/library-v3.ts";
import {
  MovieEditionKeySchema,
  MOVIE_EDITION_REGISTRY,
} from "#shared/movie-editions/registry.ts";
import { CommandResultSchema } from "#shared/api.ts";
import { readApi, writeApi, queryClient } from "#client/api.ts";
import { ErrorNotice, Loading } from "#client/components.tsx";
import type { z } from "zod";

const DetailSchema = HandoffDetailSchema.safeExtend({
  scope: HandoffScopeProtocolSchema,
});

export function LibraryPlan({ actorId }: { actorId: string }) {
  const [params] = useSearchParams();
  const id = params.get("handoff");
  const detail = useQuery({
    queryKey: ["library-plan", id],
    enabled: id !== null,
    queryFn: async () => {
      if (id === null) throw new Error("The import plan is missing");
      return readApi(`/admin/handoffs/${id}`, DetailSchema);
    },
    refetchInterval: 2000,
  });
  if (id === null) return null;
  if (detail.isPending) return <Loading />;
  if (detail.error !== null) return <ErrorNotice error={detail.error} />;
  return (
    <PlanReview
      key={`${id}:${String(detail.data.version)}`}
      detail={detail.data}
      actorId={actorId}
    />
  );
}

function PlanReview({
  detail,
  actorId,
}: {
  detail: z.infer<typeof DetailSchema>;
  actorId: string;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const apply = useMutation({
    mutationFn: async () =>
      writeApi({
        actorId,
        path: `/admin/handoffs/${detail.id}/apply`,
        schema: CommandResultSchema,
        body: ApplyLibraryHandoffV3Schema.parse({
          schemaVersion: 3,
          expectedVersion: detail.version,
          planHash: detail.planHash,
          recoveryEpoch: detail.scope.request.recoveryEpoch,
          runtimeVersion: detail.scope.request.runtimeVersion,
          acknowledgeRecoveryHolds: true,
        }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["library-plan", detail.id],
      });
    },
  });
  const scope = detail.scope;
  if (!("schemaVersion" in scope) || scope.schemaVersion !== 3)
    return (
      <p>
        This plan uses an earlier import protocol. Prepare a new file batch to
        review automatic Plex label correction.
      </p>
    );
  const plan =
    detail.plan === null
      ? null
      : FinishedLibraryHandoffV3Schema.parse(detail.plan);
  const expired =
    detail.expiresAt !== null && Date.parse(detail.expiresAt) <= Date.now();
  return (
    <section className="panel library-plan">
      <h2>Review file adoption</h2>
      <p role="status">
        {detail.state.replaceAll("_", " ")}
        {expired && detail.state === "awaiting_review"
          ? " · review expired; prepare a fresh batch"
          : ""}
      </p>
      {(detail.state === "preparing" || detail.state === "applying") && (
        <p>
          Checks run in the background.{" "}
          <Link to="/activity">View activity</Link> for progress or failures.
        </p>
      )}
      <p>
        Existing files stay at their current paths. Movie cuts are assigned
        before ownership; Plex edits retain the existing item and watch state.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Existing file</th>
              <th>Cut</th>
              <th>Plex edition label</th>
            </tr>
          </thead>
          <tbody>
            {scope.files.map((file) => {
              const edition = MovieEditionKeySchema.parse(file.edition);
              const edit = plan?.plexEdits.find(
                (item) => item.assetId === file.assetId,
              );
              return (
                <tr key={file.assetId}>
                  <td data-label="Existing file">
                    <code>{file.canonicalPath}</code>
                    <br />
                    {file.mediaIds.length} mapped item(s)
                  </td>
                  <td data-label="Cut">
                    {file.libraryKind === "movies"
                      ? MOVIE_EDITION_REGISTRY[edition].displayLabel
                      : "TV / anime episode mapping"}
                  </td>
                  <td data-label="Plex edition label">
                    {edit === undefined ? (
                      plan === null ? (
                        "Awaiting Plex check"
                      ) : (
                        "No label change planned"
                      )
                    ) : (
                      <>
                        {edit.beforeEditionTitle === null ||
                        edit.beforeEditionTitle === ""
                          ? "Unmarked"
                          : edit.beforeEditionTitle}{" "}
                        → {edit.targetEditionTitle || "Unmarked"}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p>
        {scope.subtitles.length} captions · {scope.subtitlePolicies.length}{" "}
        subtitle policies · {scope.request.profiles.length} quality profile
        bindings
      </p>
      {scope.protected.length > 0 && (
        <div className="notice">
          <p>Protected records</p>
          <ul>
            {scope.protected.map((item) => (
              <li key={item.provenanceKey}>
                {item.reason.replaceAll("_", " ")}
              </li>
            ))}
          </ul>
        </div>
      )}
      {detail.expiresAt !== null && detail.state === "awaiting_review" && (
        <p>Review expires {new Date(detail.expiresAt).toLocaleString()}.</p>
      )}
      {detail.state === "awaiting_review" && (
        <>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => {
                setAcknowledged(event.target.checked);
              }}
            />
            I approve these file classifications and Plex label changes, and
            understand recovery holds remain in effect.
          </label>
          <button
            className="button primary"
            disabled={
              !acknowledged ||
              expired ||
              apply.isPending ||
              plan === null ||
              detail.planHash === null
            }
            onClick={() => {
              apply.mutate();
            }}
          >
            Adopt files and correct Plex labels
          </button>
        </>
      )}
      {detail.receiptId !== null && (
        <p role="status">
          Adoption recorded. Receipt <code>{detail.receiptId}</code>.
        </p>
      )}
      <details>
        <summary>Review reference</summary>
        <code>{detail.id}</code>
        <p>Keep this page URL to return to this plan.</p>
      </details>
      {apply.error !== null && <ErrorNotice error={apply.error} />}
    </section>
  );
}
