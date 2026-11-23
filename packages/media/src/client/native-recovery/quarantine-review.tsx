import type { z } from "zod";
import { Link } from "react-router";
import type { NativeLifecycleDetailSchema } from "#shared/native-recovery/lifecycle.ts";
import {
  PageTitle,
  Loading,
  ErrorNotice,
  humanize,
} from "#client/components.tsx";
import { NativeReviewStatus } from "./review-status.tsx";
import { QuarantineContinuations } from "./continuations.tsx";

type Detail = z.infer<typeof NativeLifecycleDetailSchema>;
type Policies = Extract<
  Detail["scope"],
  { subtitlePolicies: unknown }
>["subtitlePolicies"];

/** The review of files that were in quarantine, as it was before the other file reviews were redesigned. */
export function QuarantineFileReview({
  review,
  loading,
  loadError,
  applyError,
  applying,
  onApply,
  acknowledged,
  onAcknowledge,
  subtitlePolicies,
  quarantined,
}: {
  review: Detail | undefined;
  loading: boolean;
  loadError: Error | null;
  applyError: Error | null;
  applying: boolean;
  onApply: () => void;
  acknowledged: boolean;
  onAcknowledge: (checked: boolean) => void;
  subtitlePolicies: Policies;
  quarantined: boolean;
}) {
  return (
    <>
      <PageTitle
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
        <Link to="/manage/recovery/native">All native recovery reviews</Link>
      </p>
      {loading && <Loading />}
      {loadError !== null && <ErrorNotice error={loadError} />}
      {applyError !== null && <ErrorNotice error={applyError} />}
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
                      onAcknowledge(event.target.checked);
                    }}
                  />
                  I reviewed these titles, subtitle policies and physical
                  proofs. I understand missing household history remains
                  protected.
                </label>
                <button
                  className="button primary"
                  disabled={!acknowledged || applying}
                  onClick={() => {
                    onApply();
                  }}
                >
                  {applying
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
