import type { z } from "zod";
import { Link } from "react-router";
import type { NativeLifecycleDetailSchema } from "#shared/native-recovery/lifecycle.ts";
import type { NativeArchiveScope } from "#shared/native-recovery/archive.ts";
import { PageTitle, ErrorNotice, humanize } from "#client/components.tsx";
import { archiveBytes, archiveReasons, archiveRoles } from "./presentation.ts";

type Detail = z.infer<typeof NativeLifecycleDetailSchema>;
export function NativeArchiveReview({
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
  review: Detail;
  scope: NativeArchiveScope;
  acknowledged: boolean;
  onAcknowledge: (value: boolean) => void;
  onApply: () => void;
  pending: boolean;
  error: Error | null;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <>
      <PageTitle
        eyebrow="Exact physical review"
        title="Resume archive expiry cleanup"
      >
        <p>
          Only the explicitly selected old versions can become eligible for
          expiry cleanup. Current playback and unselected archives remain
          retained.
        </p>
      </PageTitle>
      <p>
        <Link to="/recovery/native/archives">All upgrade archives</Link> ·{" "}
        <Link to="/recovery">Household protection</Link>
      </p>
      <button className="button" onClick={onRefresh} disabled={refreshing}>
        {refreshing
          ? "Refreshing…"
          : "Refresh current protection and cleanup status"}
      </button>
      {error !== null && <ErrorNotice error={error} />}
      <section className="panel">
        <h2>{humanize(review.state)}</h2>
        <p>
          Approval itself deletes nothing. The original deadlines, subtitle
          quality and historical work remain unchanged. Fresh playback, content
          and household checks are required before cleanup.
        </p>
        {review.state === "preparing" && (
          <p>
            Workers are checking the complete file relationships, storage and
            current Plex playback.
          </p>
        )}
        {review.state === "applied" && (
          <p>
            Physical responsibility is recorded. Newly recovered titles retain
            recovery holds; unchanged prior grants do not renew them. Review
            current household intent separately.
          </p>
        )}
      </section>
      <section className="panel">
        <h2>Selected and retained files</h2>
        {scope.files.map((file) => (
          <article key={file.assetId}>
            <h3>{archiveRoles[file.role]}</h3>
            <p>
              {scope.media
                .filter((media) => file.mediaIds.includes(media.id))
                .map((media) => media.title)
                .join(" · ")}
            </p>
            <p>
              {archiveBytes(file.sizeBytes)} · {file.subtitles.length} subtitle
              records. Quality and provenance are preserved.
            </p>
            <p>
              {file.authority.kind === "rebaseline"
                ? "This exact physical version needs new ownership proof."
                : "An exact recorded physical approval or publication transition is reused; ownership versions and holds are not renewed."}
            </p>
            {scope.edges
              .filter((edge) => edge.assetId === file.assetId)
              .map((edge) => (
                <p key={edge.id}>
                  {edge.selected ? "Selected cleanup" : "Retained dependency"} ·
                  Original expiry: {new Date(edge.expiresAt).toLocaleString()}
                </p>
              ))}
          </article>
        ))}
      </section>
      {scope.supersessions !== undefined && (
        <section className="panel">
          <h2>Replace stopped cleanup approvals</h2>
          <p>
            This review replaces {scope.supersessions.length} earlier cleanup
            approval(s) after a recorded upgrade. Earlier workers must have
            stopped, all retained files must be unchanged, and no earlier purge
            may have begun. The original expiry deadlines remain unchanged.
          </p>
        </section>
      )}
      {scope.terminalDependencies.length > 0 && (
        <section className="panel">
          <h2>Already removed dependencies</h2>
          <p>
            {scope.terminalDependencies.length} completed cleanup record(s) must
            match fresh absence and journal proofs. They are not adopted or
            selected again.
          </p>
        </section>
      )}
      {(review.archiveContinuations?.length ?? 0) > 0 && (
        <section className="panel">
          <h2>Expiry cleanup status</h2>
          {review.archiveContinuations?.map((item) => (
            <article key={item.id}>
              <h3>
                {item.titles.join(" · ")} · {humanize(item.state)}
              </h3>
              <p>
                Original expiry: {new Date(item.expiresAt).toLocaleString()}
              </p>
              {item.state === "superseded" && (
                <p>
                  A newer exact review replaced this stopped approval. This
                  approval cannot restart or delete files; it is not a cleanup
                  completion.
                </p>
              )}
              {item.reasons.map((reason) => (
                <p key={reason}>{archiveReasons[reason]}</p>
              ))}
            </article>
          ))}
        </section>
      )}
      <section className="panel">
        <h2>What this approval permits</h2>
        <ul>
          <li>
            Resume only selected archive expiry cleanup after its original
            deadline and all current protections clear.
          </li>
          <li>
            Retain current playable versions and dependency-only archives.
          </li>
          <li>
            Preserve Keep choices, pins and current demand. Ownership proof is
            not a household declaration.
          </li>
        </ul>
        <p>
          A later upgrade needs its exact durable publication record and proof
          that earlier cleanup stopped without effects. Missing records or
          incomplete effects remain protected; another review cannot override
          them.
        </p>
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
              I reviewed the selected cleanups, retained files and original
              deadlines. Household and playback protections still apply.
            </label>
            <button
              className="button primary"
              disabled={!acknowledged || pending}
              onClick={onApply}
            >
              {pending
                ? "Submitting approval…"
                : "Resume archive expiry cleanup"}
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
          {scope.files.map((file) => (
            <p key={file.assetId}>
              {file.canonicalPath}
              <br />
              SHA-256: {file.checksum}
            </p>
          ))}
        </details>
      </section>
    </>
  );
}
