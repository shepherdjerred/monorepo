import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import { NativeLifecycleDetailSchema } from "#shared/native-recovery/lifecycle.ts";
import { readApi } from "#client/api.ts";
import { useNativeReviewApproval } from "./approval.ts";
import { NativeReviewStatus } from "./review-status.tsx";
import { QuarantineContinuations } from "./continuations.tsx";
import { NativeArchiveReview } from "./archive/review.tsx";
import { NativeCompensationReview } from "./compensation/review.tsx";
import {
  nativeReviewIdentity,
  nativeReviewAcknowledged,
} from "./acknowledgement.ts";
import type { z } from "zod";
import {
  PageTitle,
  Loading,
  ErrorNotice,
  humanize,
} from "#client/components.tsx";

export function NativeRecoveryReview({
  user,
  id,
}: {
  user: MediaUser;
  id: string;
}) {
  const [acknowledgement, setAcknowledgement] = useState<string | null>(null);
  const result = useQuery({
    queryKey: ["native-recovery-detail", id],
    queryFn: () =>
      readApi(`/admin/native-recovery/${id}`, NativeLifecycleDetailSchema),
    refetchInterval: (query) => reviewInterval(query.state.data),
  });
  const acknowledged = nativeReviewAcknowledged(acknowledgement, result.data);
  const setAcknowledged = (checked: boolean) => {
    setAcknowledgement(checked ? nativeReviewIdentity(result.data) : null);
  };
  const apply = useNativeReviewApproval({
    user,
    id,
    acknowledgement,
    onSuccess: async () => {
      await result.refetch();
    },
  });
  const review = result.data;
  const compensationScope = compensationSelection(review);
  if (compensationScope !== null && review !== undefined)
    return (
      <NativeCompensationReview
        user={user}
        review={review}
        scope={compensationScope}
        acknowledged={acknowledged}
        onAcknowledge={setAcknowledged}
        onApply={() => {
          apply.mutate();
        }}
        pending={apply.isPending}
        error={apply.error ?? result.error}
        onRefresh={() => {
          void result.refetch();
        }}
        refreshing={result.isFetching}
      />
    );
  const subtitlePolicies = reviewSubtitlePolicies(review);
  const quarantined = quarantineSelection(review);
  const archiveScope = archiveSelection(review);
  if (archiveScope !== null && review !== undefined)
    return (
      <NativeArchiveReview
        review={review}
        scope={archiveScope}
        acknowledged={acknowledged}
        onAcknowledge={setAcknowledged}
        onApply={() => {
          apply.mutate();
        }}
        pending={apply.isPending}
        error={apply.error ?? result.error}
        onRefresh={() => {
          void result.refetch();
        }}
        refreshing={result.isFetching}
      />
    );
  return (
    <>
      <PageTitle
        eyebrow="Exact physical review"
        title={
          quarantined
            ? "Recover quarantined file ownership"
            : "Recover selected file ownership"
        }
      >
        <p>
          File checks prove these physical versions. They cannot recover
          household choices lost after the backup.
        </p>
      </PageTitle>
      <p>
        <Link to="/recovery/native">All native recovery reviews</Link>
      </p>
      {result.isPending && <Loading />}
      {result.error !== null && <ErrorNotice error={result.error} />}
      {apply.error !== null && <ErrorNotice error={apply.error} />}
      {review !== undefined && (
        <>
          <NativeReviewStatus state={review.state} quarantined={quarantined} />
          <QuarantineContinuations items={review.continuations} />
          <section className="panel">
            <h2>Affected titles</h2>
            {review.scope.files.map((file) => (
              <article key={file.assetId}>
                <h3>
                  {review.scope.media
                    .filter((media) => file.mediaIds.includes(media.id))
                    .map((media) => media.title)
                    .join(" · ")}
                </h3>
                <p>
                  {file.subtitles.length}{" "}
                  {quarantined ? "quarantined" : "installed"} subtitles
                  included. Their accepted, unverified or rejected quality
                  status will be preserved.
                </p>
                {file.subtitles.length > 0 && (
                  <ul>
                    {file.subtitles.map((subtitle) => (
                      <li key={subtitle.id}>
                        {subtitle.language} · {humanize(subtitle.storageKind)} ·{" "}
                        {humanize(subtitle.qualityStatus)}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </section>
          <section className="panel">
            <h2>Subtitle policies being renewed</h2>
            {subtitlePolicies.map((policy) => (
              <article key={policy.mediaId}>
                <h3>
                  {
                    review.scope.media.find(
                      (media) => media.id === policy.mediaId,
                    )?.title
                  }
                </h3>
                {policy.effective === null ? (
                  <p>No restored policy; no policy authority will be added.</p>
                ) : (
                  <>
                    <ul>
                      {policy.effective.rules.targets.map((target, index) => (
                        <li key={`${target.language}:${String(index)}`}>
                          {target.language} ·{" "}
                          {target.forced
                            ? "Forced subtitles"
                            : "Full subtitles"}{" "}
                          · Hearing impaired: {humanize(target.hearingImpaired)}{" "}
                          · Audio condition: {humanize(target.audio)}; policy
                          audio language: {target.audioLanguage}
                        </li>
                      ))}
                    </ul>
                    {policy.effective.rules.protectedReasons.length > 0 && (
                      <p>
                        Preserved blockers:{" "}
                        {policy.effective.rules.protectedReasons
                          .map((reason) => humanize(reason))
                          .join("; ")}
                      </p>
                    )}
                  </>
                )}
              </article>
            ))}
          </section>
          <section className="panel">
            <h2>What this approval changes</h2>
            <ul>
              <li>
                Renews ownership only for the exact reviewed videos and{" "}
                {quarantined ? "quarantined" : "installed"} subtitle files.
              </li>
              <li>
                Creates selected-title subtitle policy versions with the
                reviewed rules; other titles keep their prior policies.
              </li>
              <li>
                Keeps recovery holds and personal Keep choices and pins.
                Existing work and delivery history is preserved.
              </li>
              <li>
                New acquisition needs a current authorized request or an
                explicit positive household declaration.
              </li>
              {quarantined && (
                <li>
                  Restoration requires current positive authority for every
                  covered leaf. Mixed positive and negative demand on a shared
                  file remains protected; a negative declaration never
                  authorizes restoration or deletion.
                </li>
              )}
            </ul>
            {review.state === "awaiting_review" && (
              <>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(event) => {
                      setAcknowledged(event.target.checked);
                    }}
                  />
                  I reviewed these titles, subtitle policies and physical
                  proofs. I understand missing household history remains
                  protected.
                </label>
                <button
                  className="button primary"
                  disabled={!acknowledged || apply.isPending}
                  onClick={() => {
                    apply.mutate();
                  }}
                >
                  {apply.isPending
                    ? "Submitting approval…"
                    : "Apply this exact physical review"}
                </button>
              </>
            )}
            <details>
              <summary>Operator proof details</summary>
              <p>
                Review expires:{" "}
                {review.expiresAt === null
                  ? "Not prepared"
                  : new Date(review.expiresAt).toLocaleString()}
              </p>
              <p>Plan digest: {review.planHash ?? "Pending inspection"}</p>
              {review.scope.files.map((file) => (
                <p key={file.assetId}>
                  {file.canonicalPath}
                  <br />
                  Recorded SHA-256: {file.checksum}
                </p>
              ))}
              <p>Selected policy snapshots: {subtitlePolicies.length}</p>
            </details>
          </section>
        </>
      )}
    </>
  );
}

function reviewSubtitlePolicies(
  review: z.infer<typeof NativeLifecycleDetailSchema> | undefined,
) {
  return review !== undefined && "subtitlePolicies" in review.scope
    ? review.scope.subtitlePolicies
    : [];
}

function compensationSelection(
  review: z.infer<typeof NativeLifecycleDetailSchema> | undefined,
) {
  const scope = review?.scope;
  return scope?.schemaVersion === 2 &&
    scope.lifecycleKind === "publication_compensation"
    ? scope
    : null;
}

function archiveSelection(
  review: z.infer<typeof NativeLifecycleDetailSchema> | undefined,
) {
  const scope = review?.scope;
  return scope?.schemaVersion === 2 &&
    scope.lifecycleKind === "superseded_archive"
    ? scope
    : null;
}

function quarantineSelection(
  review: z.infer<typeof NativeLifecycleDetailSchema> | undefined,
) {
  return (
    review?.scope.schemaVersion === 2 &&
    review.scope.lifecycleKind === "committed_quarantine"
  );
}

function reviewInterval(
  review: z.infer<typeof NativeLifecycleDetailSchema> | undefined,
) {
  if (
    review?.compensationContinuations?.some(
      (item) =>
        item.state === "pending" ||
        item.state === "compensating" ||
        item.publicationState === "publishing",
    ) === true
  )
    return 5000;
  if (
    ["preparing", "applying"].includes(review?.state ?? "") ||
    review?.continuations.some(
      (item) =>
        item.state === "restoring" ||
        (item.state === "restored" &&
          item.media.some((media) => media.availability === "importing")),
    ) === true
  )
    return 5000;
  return review?.archiveContinuations?.some(
    (item) => item.state === "pending" || item.state === "cleaning",
  ) === true
    ? 15_000
    : false;
}
