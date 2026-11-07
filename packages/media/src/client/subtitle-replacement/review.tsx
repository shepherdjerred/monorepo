import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import { SubtitleReplacementDetailSchema } from "#shared/subtitle-replacement.ts";
import type { z } from "zod";
import { readApi } from "#client/api.ts";
import { movieEditionDisplayLabel } from "#shared/movie-editions/registry.ts";
import { CommandError } from "#client/target-controls/errors.tsx";
import { useSubtitleReplacementCommand } from "./command.ts";
import {
  PageTitle,
  Loading,
  ErrorNotice,
  humanize,
} from "#client/components.tsx";

type Review = z.infer<typeof SubtitleReplacementDetailSchema>;
type Acknowledgement = { version: number; observationHash: string };
function matchesAcknowledgement(
  review: Review | undefined,
  acknowledgement: Acknowledgement | null,
) {
  return (
    review !== undefined &&
    acknowledgement !== null &&
    acknowledgement.version === review.version &&
    acknowledgement.observationHash === review.observationHash
  );
}
function reviewExpired(review: Review | undefined) {
  return (
    review?.reviewExpiresAt !== null &&
    review?.reviewExpiresAt !== undefined &&
    Date.parse(review.reviewExpiresAt) <= Date.now()
  );
}

export function SubtitleReplacementReview({
  user,
  id,
}: {
  user: MediaUser;
  id: string;
}) {
  const [acknowledgedReview, setAcknowledgedReview] = useState<{
    version: number;
    observationHash: string;
  } | null>(null);
  const result = useQuery({
    queryKey: ["subtitle-replacement", id],
    queryFn: () =>
      readApi(
        `/admin/subtitle-replacements/${id}`,
        SubtitleReplacementDetailSchema,
      ),
    refetchInterval: 5000,
  });
  const command = useSubtitleReplacementCommand(user.id, id, async () => {
    setAcknowledgedReview(null);
    await result.refetch();
  });
  const review = result.data;
  const acknowledged = matchesAcknowledgement(review, acknowledgedReview);
  const expired = reviewExpired(review);
  return (
    <>
      <PageTitle
        eyebrow="Exact subtitle review"
        title="Replace an installed subtitle"
      >
        <p>
          Replace one owned sidecar at its existing filename. The video remains
          unchanged.
        </p>
      </PageTitle>
      <p>
        <Link to="/admin/subtitle-replacements">All subtitle replacements</Link>
      </p>
      {result.isPending && <Loading />}
      {result.error !== null && <ErrorNotice error={result.error} />}
      <CommandError
        error={command.error}
        review={() => {
          command.reset();
          setAcknowledgedReview(null);
          void result.refetch();
        }}
      />
      {command.unknown && (
        <button
          className="button"
          disabled={command.isPending}
          onClick={command.retryOriginal}
        >
          Retry original subtitle action
        </button>
      )}
      {review !== undefined && (
        <>
          <ReplacementStatus review={review} expired={expired} />
          <section className="panel">
            <h2>Affected titles</h2>
            {review.movieScope !== undefined && (
              <p>
                Movie edition:{" "}
                {movieEditionDisplayLabel(review.movieScope.edition)}
              </p>
            )}
            <ul>
              {review.titles.map((title) => (
                <li key={title.mediaId}>
                  <Link to={`/media/${title.mediaId}`}>{title.title}</Link>
                </li>
              ))}
            </ul>
            <p>
              <strong>{review.destinationName}</strong>
            </p>
            <p>
              {review.language} · {forcedLabel(review.forced)} ·
              Hearing-impaired: {hearingLabel(review.hearingImpaired)}
            </p>
            <dl className="detail-grid">
              <div>
                <dt>Current subtitle</dt>
                <dd>
                  {review.oldProvider} · {humanize(review.oldQuality)}
                </dd>
              </div>
              <div>
                <dt>Replacement</dt>
                <dd>
                  {review.newProvider} · {humanize(review.newQuality)}
                </dd>
              </div>
            </dl>
          </section>
          <section className="panel">
            <h2>Review and recovery</h2>
            <p>
              The retained original is a recovery artifact, not a second
              selectable subtitle. Its provenance and quality record remain
              intact. Cleanup begins only after the operation settles and the
              retention period expires.
            </p>
            <p>
              Review expires:{" "}
              {review.reviewExpiresAt === null
                ? "Pending inspection"
                : new Date(review.reviewExpiresAt).toLocaleString()}
              .
            </p>
            {review.archiveExpiresAt !== null && (
              <p>
                Recovery archive retained until{" "}
                {new Date(review.archiveExpiresAt).toLocaleString()} · Cleanup:{" "}
                {humanize(review.cleanupState)}.
              </p>
            )}
            {review.cleanupReason !== null && (
              <p role="status">
                Recovery archive cleanup is protected:{" "}
                {humanize(review.cleanupReason)}. The installed replacement
                remains unchanged.
              </p>
            )}
            {review.state === "awaiting_review" && !expired && (
              <>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(event) => {
                      setAcknowledgedReview(
                        event.target.checked && review.observationHash !== null
                          ? {
                              version: review.version,
                              observationHash: review.observationHash,
                            }
                          : null,
                      );
                    }}
                  />
                  I reviewed every affected title and want this validated
                  subtitle to replace the installed file at the same filename.
                </label>
                <button
                  className="button primary"
                  disabled={!acknowledged || command.blocked}
                  onClick={() => {
                    if (acknowledged && acknowledgedReview !== null)
                      command.submit({
                        action: "apply",
                        body: {
                          expectedVersion: acknowledgedReview.version,
                          observationHash: acknowledgedReview.observationHash,
                          acknowledgeReplacement: true,
                        },
                      });
                  }}
                >
                  Approve this replacement
                </button>
              </>
            )}
            {review.reservationActive && (
              <button
                className="button"
                disabled={
                  command.blocked ||
                  review.state === "applying" ||
                  review.state === "preparing"
                }
                onClick={() => {
                  command.submit({
                    action: "reconcile",
                    body: { expectedVersion: review.version },
                  });
                }}
              >
                {command.isPending ? "Submitting…" : "Reconcile operation"}
              </button>
            )}
          </section>
        </>
      )}
    </>
  );
}

function forcedLabel(value: boolean | null) {
  if (value === null) return "Forced status unknown";
  return value ? "Forced dialogue" : "Full subtitles";
}
function hearingLabel(value: boolean | null) {
  if (value === null) return "Unknown";
  return value ? "Included" : "Absent";
}

function ReplacementStatus({
  review,
  expired,
}: {
  review: z.infer<typeof SubtitleReplacementDetailSchema>;
  expired: boolean;
}) {
  const messages: Partial<Record<typeof review.state, string>> = {
    preparing:
      "The worker is checking the video, installed subtitle and replacement bytes. No file has been replaced.",
    applying:
      "Your approval is queued. Current ownership and file identity are checked again before replacement.",
    applied:
      "The replacement is installed. The earlier file is retained temporarily for recovery only; this screen does not offer undo.",
    rolled_back:
      "The interrupted replacement was compensated. The previous subtitle was restored.",
    abandoned:
      "This review ended without a replacement. Prepare a new review to try again.",
  };
  return (
    <section className="panel">
      <h2>
        {humanize(review.state)}
        {expired && review.state === "awaiting_review"
          ? " · Review expired"
          : ""}
      </h2>
      {review.reason !== null && <p role="status">{humanize(review.reason)}</p>}
      {messages[review.state] !== undefined && <p>{messages[review.state]}</p>}
      {review.reservationActive && (
        <p>
          Video changes and other subtitle installs are held while this
          operation is unsettled. Reconciliation checks the recorded effects; it
          releases an abandoned review only when no uncertain effect remains.
        </p>
      )}
    </section>
  );
}
