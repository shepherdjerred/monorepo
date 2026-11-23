import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import type { z } from "zod";
import type { MediaUser } from "#shared/contract.ts";
import { SubtitleReplacementDetailSchema } from "#shared/subtitle-replacement.ts";
import { movieEditionDisplayLabel } from "#shared/movie-editions/registry.ts";
import { readApi } from "#client/api.ts";
import { PageTitle } from "#client/components.tsx";
import { Button, ButtonLink } from "#client/ui/button.tsx";
import { ConfirmDialog } from "#client/ui/confirm-dialog.tsx";
import { Callout, LoadError } from "#client/ui/feedback.tsx";
import { CheckboxField } from "#client/ui/forms/field.tsx";
import { Panel, SkeletonRows } from "#client/ui/panel.tsx";
import {
  Code,
  Decision,
  Facts,
  TechnicalDetails,
} from "#client/ui/workflow.tsx";
import { useSubtitleReplacementCommand } from "./command.ts";
import { CommandFailure } from "./failure.tsx";
import {
  REPLACEMENT_STATE,
  SUBTITLE_QUALITY,
  forcedLabel,
  hearingLabel,
  phrase,
} from "./vocabulary.ts";

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

function when(value: string): string {
  return new Date(value).toLocaleString();
}

/** One replacement: what it replaces, where it stands, and the owner's decision. */
export function SubtitleReplacementReview({
  user,
  id,
}: {
  user: MediaUser;
  id: string;
}) {
  const [acknowledgedReview, setAcknowledgedReview] =
    useState<Acknowledgement | null>(null);
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
  return (
    <>
      <PageTitle title="Replace an installed subtitle">
        <p>
          Replace one owned sidecar at its existing filename. The video is not
          changed.
        </p>
        <p>
          <ButtonLink to="/manage/subtitles/replacements">
            All subtitle replacements
          </ButtonLink>
        </p>
      </PageTitle>
      {result.isPending && (
        <Panel title="Replacement">
          <SkeletonRows label="Loading the replacement" rows={3} tall />
        </Panel>
      )}
      {result.error !== null && (
        <LoadError
          what="The replacement"
          error={result.error}
          retry={() => {
            void result.refetch();
          }}
        />
      )}
      {review !== undefined && (
        <ReplacementDetail
          review={review}
          acknowledged={matchesAcknowledgement(review, acknowledgedReview)}
          onAcknowledge={setAcknowledgedReview}
          command={command}
          onReview={() => {
            command.reset();
            setAcknowledgedReview(null);
            void result.refetch();
          }}
        />
      )}
    </>
  );
}

type Command = ReturnType<typeof useSubtitleReplacementCommand>;

function ReplacementDetail({
  review,
  acknowledged,
  onAcknowledge,
  command,
  onReview,
}: {
  review: Review;
  acknowledged: boolean;
  onAcknowledge: (value: Acknowledgement | null) => void;
  command: Command;
  onReview: () => void;
}) {
  const state = REPLACEMENT_STATE[review.state];
  const expired = reviewExpired(review);
  return (
    <>
      <Panel id="state" title={state.label}>
        <Callout tone={state.tone}>
          {state.meaning}
          {expired &&
            review.state === "awaiting_review" &&
            " This review has expired."}
        </Callout>
        {review.reason !== null && (
          <Callout tone="warn">
            <span role="status">{phrase(review.reason)}</span>
          </Callout>
        )}
        {review.reservationActive && (
          <p>
            Video changes and other subtitle installs are held while this
            operation is unsettled. Reconciliation checks the recorded effects;
            it releases an abandoned review only when no uncertain effect
            remains.
          </p>
        )}
      </Panel>
      <Panel
        id="replacement"
        title="What is replaced"
        description={
          <p>
            The validated subtitle takes the place of the installed one at the
            same filename.
          </p>
        }
      >
        <Facts
          items={[
            {
              name: review.titles.length === 1 ? "Title" : "Titles",
              value: (
                <>
                  {review.titles.map((title, index) => (
                    <span key={title.mediaId}>
                      {index === 0 ? "" : ", "}
                      <Link to={`/media/${title.mediaId}`}>{title.title}</Link>
                    </span>
                  ))}
                </>
              ),
            },
            ...(review.movieScope === undefined
              ? []
              : [
                  {
                    name: "Movie edition",
                    value: movieEditionDisplayLabel(review.movieScope.edition),
                  },
                ]),
            { name: "Subtitle file", value: review.destinationName },
            { name: "Language", value: review.language },
            { name: "Kind", value: forcedLabel(review.forced) },
            {
              name: "Hearing-impaired captions",
              value: hearingLabel(review.hearingImpaired),
            },
            {
              name: "Current subtitle",
              value: `${review.oldProvider}, ${SUBTITLE_QUALITY[review.oldQuality].toLowerCase()}`,
            },
            {
              name: "Replacement",
              value: `${review.newProvider}, ${SUBTITLE_QUALITY[review.newQuality].toLowerCase()}`,
            },
          ]}
        />
      </Panel>
      <Panel
        id="decision"
        title="Approve and recover"
        description={
          <p>
            The retained original is a recovery artifact, not a second
            selectable subtitle. Its provenance and quality record stay intact.
            Cleanup begins only after the operation settles and the retention
            period ends.
          </p>
        }
      >
        <Facts
          items={[
            {
              name: "Review expires",
              value:
                review.reviewExpiresAt === null
                  ? "Pending inspection"
                  : when(review.reviewExpiresAt),
            },
            ...(review.archiveExpiresAt === null
              ? []
              : [
                  {
                    name: "Recovery archive kept until",
                    value: when(review.archiveExpiresAt),
                  },
                  {
                    name: "Archive cleanup",
                    value: phrase(review.cleanupState),
                  },
                ]),
          ]}
        />
        {review.cleanupReason !== null && (
          <Callout tone="warn">
            <span role="status">
              Recovery archive cleanup is protected:{" "}
              {phrase(review.cleanupReason).toLowerCase()}. The installed
              replacement is unchanged.
            </span>
          </Callout>
        )}
        {review.state === "awaiting_review" && !expired && (
          <ApproveReplacement
            review={review}
            acknowledged={acknowledged}
            onAcknowledge={onAcknowledge}
            command={command}
          />
        )}
        {review.reservationActive && (
          <Decision title="Reconcile this operation">
            <p>
              Reconciling checks the effects recorded for this operation and
              settles it. It releases an abandoned review only when no uncertain
              effect remains.
            </p>
            <div>
              <Button
                busy={command.isPending}
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
              </Button>
            </div>
          </Decision>
        )}
        <CommandFailure
          error={command.error}
          what="The action"
          unknown={command.unknown}
          pending={command.isPending}
          onReview={onReview}
          onRetry={command.retryOriginal}
        />
      </Panel>
      <TechnicalDetails>
        <p>
          Review reference <Code>{review.id}</Code>, version {review.version}.
        </p>
        <p>
          Observation hash{" "}
          <Code>{review.observationHash ?? "Not prepared yet"}</Code>
        </p>
        <p>Receipt outcome: {review.receiptOutcome ?? "None yet"}.</p>
      </TechnicalDetails>
    </>
  );
}

function ApproveReplacement({
  review,
  acknowledged,
  onAcknowledge,
  command,
}: {
  review: Review;
  acknowledged: boolean;
  onAcknowledge: (value: Acknowledgement | null) => void;
  command: Command;
}) {
  const confirm = useRef<HTMLDialogElement>(null);
  return (
    <Decision title="Approve this replacement">
      <p>
        Approving replaces {review.destinationName} with the validated subtitle.
        The video is not changed. This page does not offer undo.
      </p>
      <CheckboxField
        label="I reviewed every affected title and want this validated subtitle to replace the installed file at the same filename."
        checked={acknowledged}
        onChange={(event) => {
          onAcknowledge(
            event.currentTarget.checked && review.observationHash !== null
              ? {
                  version: review.version,
                  observationHash: review.observationHash,
                }
              : null,
          );
        }}
      />
      <div>
        <Button
          variant="primary"
          busy={command.isPending}
          disabled={!acknowledged || command.blocked}
          onClick={() => {
            confirm.current?.showModal();
          }}
        >
          Approve this replacement
        </Button>
      </div>
      <ConfirmDialog
        ref={confirm}
        title={`Replace ${review.destinationName}?`}
        confirmLabel="Replace subtitle"
        danger
        onConfirm={() => {
          if (review.observationHash === null) return;
          command.submit({
            action: "apply",
            body: {
              expectedVersion: review.version,
              observationHash: review.observationHash,
              acknowledgeReplacement: true,
            },
          });
        }}
      >
        <p>
          The installed subtitle {review.destinationName} will be replaced for{" "}
          {review.titles.map((title) => title.title).join(", ")}. The earlier
          file is kept for a while for recovery only. This page does not offer
          undo.
        </p>
      </ConfirmDialog>
    </Decision>
  );
}
