import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import { CommandResultSchema } from "#shared/api.ts";
import { SubtitleReplacementDetailSchema } from "#shared/subtitle-replacement.ts";
import type { z } from "zod";
import { readApi, writeApi } from "#client/api.ts";
import {
  PageTitle,
  Loading,
  ErrorNotice,
  humanize,
} from "#client/components.tsx";

export function SubtitleReplacementReview({
  user,
  id,
}: {
  user: MediaUser;
  id: string;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const result = useQuery({
    queryKey: ["subtitle-replacement", id],
    queryFn: () =>
      readApi(
        `/admin/subtitle-replacements/${id}`,
        SubtitleReplacementDetailSchema,
      ),
    refetchInterval: 5000,
  });
  const command = useMutation({
    mutationFn: async (action: "apply" | "reconcile") => {
      const review = result.data;
      if (review === undefined)
        throw new Error("Load the current review first.");
      if (
        action === "apply" &&
        (!acknowledged || review.observationHash === null)
      )
        throw new Error("Review and acknowledge the exact replacement first.");
      return writeApi({
        actorId: user.id,
        path: `/admin/subtitle-replacements/${id}/${action}`,
        schema: CommandResultSchema,
        body:
          action === "apply"
            ? {
                expectedVersion: review.version,
                observationHash: review.observationHash,
                acknowledgeReplacement: true,
              }
            : { expectedVersion: review.version },
      });
    },
    onSuccess: async () => {
      setAcknowledged(false);
      await result.refetch();
    },
  });
  const review = result.data;
  const expired =
    review?.reviewExpiresAt !== null &&
    review?.reviewExpiresAt !== undefined &&
    Date.parse(review.reviewExpiresAt) <= Date.now();
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
      {command.error !== null && <ErrorNotice error={command.error} />}
      {review !== undefined && (
        <>
          <ReplacementStatus review={review} expired={expired} />
          <section className="panel">
            <h2>Affected titles</h2>
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
                      setAcknowledged(event.target.checked);
                    }}
                  />
                  I reviewed every affected title and want this validated
                  subtitle to replace the installed file at the same filename.
                </label>
                <button
                  className="button primary"
                  disabled={!acknowledged || command.isPending}
                  onClick={() => {
                    command.mutate("apply");
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
                  command.isPending ||
                  review.state === "applying" ||
                  review.state === "preparing"
                }
                onClick={() => {
                  command.mutate("reconcile");
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
