import type { z } from "zod";
import { Link } from "react-router";
import type { NativeCompensationScope } from "#shared/native-recovery/compensation.ts";
import { FinishedNativeCompensationSchema } from "#shared/native-recovery/compensation.ts";
import type { NativeLifecycleDetailSchema } from "#shared/native-recovery/lifecycle.ts";
import { PageTitle, ErrorNotice, humanize } from "#client/components.tsx";
import type { MediaUser } from "#shared/contract.ts";
import { CompensationStatus } from "./status.tsx";

export function NativeCompensationReview({
  user,
  review,
  scope,
  acknowledged,
  onAcknowledge,
  onApply,
  pending,
  error,
  onRefresh,
  refreshing,
}: {
  user: MediaUser;
  review: z.infer<typeof NativeLifecycleDetailSchema>;
  scope: NativeCompensationScope;
  acknowledged: boolean;
  onAcknowledge: (value: boolean) => void;
  onApply: () => void;
  pending: boolean;
  error: Error | null;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const plan =
    review.plan === null
      ? null
      : FinishedNativeCompensationSchema.parse(review.plan);
  return (
    <>
      <PageTitle
        eyebrow="Exact interrupted upgrade review"
        title="Restore reviewed predecessor files"
      >
        <p>
          Restore the earlier files and their installed subtitles while
          retaining successor bytes. This does not establish whether a successor
          was published after the backup.
        </p>
      </PageTitle>
      <p>
        <Link to="/recovery/native/compensations">
          All interrupted upgrades
        </Link>{" "}
        · <Link to="/recovery">Household protection</Link>
      </p>
      <button className="button" disabled={refreshing} onClick={onRefresh}>
        {refreshing ? "Refreshing…" : "Refresh restoration and playback status"}
      </button>
      {error !== null && <ErrorNotice error={error} />}
      <section className="panel">
        <h2>{humanize(review.state)}</h2>
        <p>
          Approval authorizes only the reviewed restoration. It changes no files
          immediately, does not resume historical work and cannot release
          household holds.
        </p>
        {review.state === "preparing" && (
          <p>
            Workers are checking the original intent, acknowledged changes,
            exact file identities, storage and current playback.
          </p>
        )}
      </section>
      <section className="panel">
        <h2>Complete upgrade coverage</h2>
        {scope.entries.map((entry) => (
          <article key={entry.entry.operationId}>
            <h3>
              {scope.media
                .filter((media) => entry.entry.mediaIds.includes(media.id))
                .map((media) => media.title)
                .join(" · ")}
            </h3>
            <p>
              Restore the predecessor and preserve{" "}
              {entry.predecessor?.subtitles.filter(
                (subtitle) => subtitle.state === "installed",
              ).length ?? 0}{" "}
              installed subtitle records with their recorded quality and
              provenance. Retain successor bytes; no retained artifact is
              selected for deletion.
            </p>
          </article>
        ))}
      </section>
      {(review.compensationContinuations?.length ?? 0) > 0 && (
        <section className="panel">
          <h2>Restoration and playback</h2>
          {review.compensationContinuations?.map((item) => (
            <CompensationStatus
              key={item.id}
              user={user}
              item={item}
              onRefresh={onRefresh}
            />
          ))}
        </section>
      )}
      <section className="panel">
        <h2>What this approval permits</h2>
        <ul>
          <li>
            Reverse only the exactly recorded changes for this complete upgrade.
          </li>
          <li>
            Retain successor files and new subtitle candidates for recovery; no
            deletion or automatic replacement.
          </li>
          <li>
            Preserve historical work, personal Keep choices, pins and household
            protection.
          </li>
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
              I reviewed the predecessor restoration, retained successor bytes
              and complete title coverage. Household holds remain in force.
            </label>
            <button
              className="button primary"
              disabled={!acknowledged || pending}
              onClick={onApply}
            >
              {pending
                ? "Submitting approval…"
                : "Approve this exact predecessor restoration"}
            </button>
          </>
        )}
        <details>
          <summary>Operator proof details</summary>
          <p>Plan digest: {review.planHash ?? "Pending inspection"}</p>
          <p>
            Review expires:{" "}
            {review.expiresAt === null
              ? "Not prepared"
              : new Date(review.expiresAt).toLocaleString()}
          </p>
          <p>
            Acknowledged effects:{" "}
            {plan?.files.acknowledgedEffects.length ?? "Pending inspection"}.
            Exact inverse steps:{" "}
            {plan?.files.steps.length ?? "Pending inspection"}.
          </p>
          {scope.entries.map((entry) => (
            <p key={entry.entry.operationId}>
              {entry.predecessor?.path}
              <br />
              Predecessor SHA-256: {entry.predecessor?.checksum}
              <br />
              Retained successor SHA-256: {entry.entry.checksum}
            </p>
          ))}
        </details>
      </section>
    </>
  );
}
