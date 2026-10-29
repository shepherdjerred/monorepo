import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import { CommandResultSchema } from "#shared/api.ts";
import {
  RecoveryListSchema,
  RecoveryDetailSchema,
  isRecoveryScopeV2,
} from "#shared/recovery.ts";
import { readApi, writeApi, queryClient } from "#client/api.ts";
import {
  PageTitle,
  ErrorNotice,
  Loading,
  Notice,
  humanize,
} from "#client/components.tsx";
import { RecoveryResponseForm, RecoveryReleaseForm } from "./review.tsx";
import { LegacyRequesterBindings } from "./legacy-bindings.tsx";
import { CapacityPanel } from "#client/capacity/panel.tsx";

export function RecoveryPage({ user }: { user: MediaUser }) {
  const { id } = useParams();
  return id === undefined ? (
    <RecoveryIndex user={user} />
  ) : (
    <RecoveryReview user={user} id={id} />
  );
}

function RecoveryIndex({ user }: { user: MediaUser }) {
  const [selected, setSelected] = useState<string[]>([]);
  const result = useQuery({
    queryKey: ["recovery"],
    queryFn: () => readApi("/recovery", RecoveryListSchema),
  });
  const prepare = useMutation({
    mutationFn: () =>
      writeApi({
        actorId: user.id,
        path: "/recovery/reviews",
        body: { mediaIds: selected },
        schema: CommandResultSchema,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["recovery"] });
    },
  });
  return (
    <>
      <PageTitle eyebrow="Household review" title="Recovery protection">
        <p>
          Restored files cannot tell us who requested them or asked to keep them
          after a backup. These titles stay protected until the household states
          its present intent.
        </p>
      </PageTitle>
      {result.isPending && <Loading />}
      {result.error !== null && <ErrorNotice error={result.error} />}
      {result.data?.authority != null && (
        <section className="panel">
          <h2>Automation authority</h2>
          <p>
            Runtime: {humanize(result.data.authority.mode)}. Ownership{" "}
            {result.data.authority.ownershipConfirmed
              ? "confirmed"
              : "not confirmed"}
            .
          </p>
          <p>
            Legacy writer authority:{" "}
            {humanize(result.data.authority.writerState)}. Storage authority:{" "}
            {humanize(result.data.authority.storageState)}.
          </p>
          <p>
            For revoked, stale or missing authority, the operator must resolve
            legacy writers or storage changes and obtain fresh observations.
            Resuming automation requires a separately reviewed ownership
            handoff.
          </p>
          <p>
            Household review below releases only the selected recovery holds. It
            does not renew writer or storage authority or activate automation.
          </p>
        </section>
      )}
      <CapacityPanel user={user} />
      {user.role === "owner" && (
        <section className="panel">
          <p>
            <Link to="/recovery/native">
              Reprove Media-published files after a database restore
            </Link>
          </p>
          <h2>Prepare a household review</h2>
          <p>
            Select protected titles. Shared physical files automatically include
            every affected episode. A completed series request can be reviewed
            one physical group at a time; other episodes and future-series
            options remain unchanged. Existing Keep and pins remain effective.
          </p>
          {result.data?.holds.map((hold) => (
            <label className="check-label" key={hold.mediaId}>
              <input
                type="checkbox"
                checked={selected.includes(hold.mediaId)}
                onChange={(event) => {
                  setSelected(
                    event.target.checked
                      ? [...selected, hold.mediaId]
                      : selected.filter((id) => id !== hold.mediaId),
                  );
                }}
              />{" "}
              {hold.title} <small>{humanize(hold.reason)}</small>
            </label>
          ))}
          {result.data?.holds.length === 0 && <p>No active recovery holds.</p>}
          <button
            className="button"
            disabled={selected.length === 0 || prepare.isPending}
            onClick={() => {
              prepare.mutate();
            }}
          >
            Prepare review
          </button>
          {prepare.error !== null && <ErrorNotice error={prepare.error} />}
          {prepare.data?.recoveryReviewId !== undefined && (
            <Notice>
              Review prepared.{" "}
              <Link to={`/recovery/${prepare.data.recoveryReviewId}`}>
                Open the exact review
              </Link>
              .
            </Notice>
          )}
        </section>
      )}
      <section className="panel">
        <h2>Your recovery reviews</h2>
        {result.data?.reviews.map((review) => (
          <p key={review.id}>
            <Link to={`/recovery/${review.id}`}>
              {review.titles.join(", ")}
            </Link>{" "}
            · {humanize(review.state)}
          </p>
        ))}
        {result.data?.reviews.length === 0 && (
          <p>No reviews need your response.</p>
        )}
      </section>
      {user.role === "owner" && !user.restricted && (
        <LegacyRequesterBindings user={user} />
      )}
    </>
  );
}

function RecoveryReview({ user, id }: { user: MediaUser; id: string }) {
  const result = useQuery({
    queryKey: ["recovery", id],
    queryFn: () => readApi(`/recovery/reviews/${id}`, RecoveryDetailSchema),
  });
  const review = result.data;
  return (
    <>
      <PageTitle
        eyebrow="Present household intent"
        title="Review protected titles"
      >
        <p>
          Your declaration stays pending until the owner applies the exact
          household review. To protect something immediately, use its existing
          Keep or pin action; that will require a fresh review.
        </p>
      </PageTitle>
      <Link to="/recovery">All recovery reviews</Link>
      {result.isPending && <Loading />}
      {result.error !== null && <ErrorNotice error={result.error} />}
      {review !== undefined && (
        <>
          <section className="panel">
            <h2>Affected titles</h2>
            {review.scope.media.map((media) => (
              <p key={media.id}>
                <Link to={`/media/${media.id}`}>{media.title}</Link>
              </p>
            ))}
            <Notice>
              {review.state === "released"
                ? "Reviewed declarations were applied and only the listed recovery holds were released. Existing pins, fresh watch checks and normal warning/grace rules still apply."
                : "Recovery protection remains in place. No pending declaration has changed requests or Keep yet."}
            </Notice>
            {review.scope.blockers.map((blocker) => (
              <Notice key={blocker} error>
                {humanize(blocker)}. This review cannot release protection until
                the owner resolves the missing evidence and prepares a new
                review.
              </Notice>
            ))}
          </section>
          <RecoveryResponseForm user={user} review={review} />
          {user.role === "owner" &&
            isRecoveryScopeV2(review.scope) &&
            review.scope.legacyClaims.length > 0 && (
              <section className="panel">
                <h2>Selected legacy claim evidence</h2>
                <p>
                  Identity associations are owner-declared. Current declarations
                  account only for the listed leaves; outside records remain
                  unresolved until separately reviewed.
                </p>
                {review.scope.legacyClaims.map((claim) => (
                  <article key={`${claim.captureHash}:${claim.provenanceKey}`}>
                    <h3>
                      {humanize(claim.sourceKind)} requester{" "}
                      {claim.requesterSourceId} · {humanize(claim.sourceScope)}
                    </h3>
                    <p>
                      {claim.seasons.length > 0
                        ? `Captured seasons: ${claim.seasons.join(", ")}. `
                        : ""}
                      Binding revision {claim.bindingRevision};{" "}
                      {claim.outsideMediaIds.length} outside leaves remain
                      outside this approval.
                    </p>
                    <ul>
                      {claim.mediaIds.map((mediaId) => (
                        <li key={mediaId}>
                          {
                            review.scope.media.find(
                              (item) => item.id === mediaId,
                            )?.title
                          }
                        </li>
                      ))}
                    </ul>
                    <details>
                      <summary>Exact provenance</summary>
                      <p>
                        Source instance {claim.sourceInstanceId}
                        <br />
                        Capture {claim.captureHash}
                        <br />
                        Record {claim.recordDigest}
                      </p>
                    </details>
                  </article>
                ))}
              </section>
            )}
          {user.role === "owner" && (
            <RecoveryReleaseForm user={user} review={review} />
          )}
        </>
      )}
    </>
  );
}
