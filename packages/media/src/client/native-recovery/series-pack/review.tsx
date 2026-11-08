import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import type { z } from "zod";
import type { MediaUser } from "#shared/contract.ts";
import type {
  NativeRecoveryDetailProtocolSchema,
  SeriesPackNativeDetailV1,
} from "#shared/native-recovery/series-pack/detail.ts";
import { CommandResultSchema } from "#shared/api.ts";
import { writeApi } from "#client/api.ts";
import { PageTitle, ErrorNotice, humanize } from "#client/components.tsx";
import { nativeReviewAcknowledged } from "#client/native-recovery/acknowledgement.ts";
import { CompensationStatus } from "#client/native-recovery/compensation/status.tsx";
import { RecoveryProofDetails } from "#client/native-recovery/proof-details.tsx";

export function SeriesPackNativeReview({
  user,
  review,
  acknowledgement,
  onAcknowledge,
  onRefresh,
  refreshing,
  error,
}: {
  user: MediaUser;
  review: SeriesPackNativeDetailV1;
  acknowledgement: string | null;
  onAcknowledge: (checked: boolean) => void;
  onRefresh: () => Promise<unknown>;
  refreshing: boolean;
  error: Error | null;
}) {
  const queryClient = useQueryClient();
  const apply = useMutation({
    mutationFn: () => {
      const current = queryClient.getQueryData<
        z.infer<typeof NativeRecoveryDetailProtocolSchema>
      >(["native-recovery-detail", review.id]);
      if (
        current === undefined ||
        !("protocol" in current) ||
        !nativeReviewAcknowledged(acknowledgement, current) ||
        current.planHash === null ||
        current.state !== "awaiting_review"
      )
        throw new Error("The file proof changed. Review it before applying.");
      return writeApi({
        actorId: user.id,
        path: `/admin/native-recovery/${current.id}/apply`,
        schema: CommandResultSchema,
        body: {
          expectedVersion: current.version,
          planHash: current.planHash,
          recoveryEpoch: current.scope.request.recoveryEpoch,
          runtimeVersion: current.scope.request.runtimeVersion,
          acknowledgeCompensationOnly: true,
          acknowledgeRecoveryHolds: true,
          acknowledgeSuccessorRetained: true,
        },
      });
    },
    onSuccess: onRefresh,
  });
  const acknowledged = nativeReviewAcknowledged(acknowledgement, review);
  const captionCount = review.scope.files.reduce(
    (count, file) => count + file.subtitles.length,
    0,
  );
  return (
    <>
      <PageTitle
        eyebrow="Interrupted TV pack review"
        title="Restore the reviewed earlier TV files"
      >
        <p>
          Review every file in this interrupted upgrade. Restoration preserves
          the earlier subtitles and retains the newer bytes for recovery.
        </p>
      </PageTitle>
      <p>
        <Link to="/recovery/native/compensations">
          All interrupted upgrades
        </Link>
        {" · "}
        <Link to="/recovery">Household protection</Link>
      </p>
      <button
        className="button"
        disabled={refreshing}
        onClick={() => {
          void onRefresh();
        }}
      >
        {refreshing ? "Refreshing…" : "Refresh restoration and playback status"}
      </button>
      {error !== null && <ErrorNotice error={error} />}
      {apply.error !== null && <ErrorNotice error={apply.error} />}
      <section className="panel">
        <h2>{humanize(review.state)}</h2>
        <p>
          {review.scope.files.length} earlier videos and {captionCount} recorded
          subtitles are included. Subtitle quality and provenance remain as
          recorded. Approval keeps household holds, personal Keep choices and
          pins in force.
        </p>
        <p>
          Restored files remain protected until every covered title has current
          positive household authority and Plex verifies the complete group.
        </p>
        {review.compensationContinuations.map((item) => (
          <CompensationStatus
            key={item.id}
            user={user}
            item={item}
            onRefresh={() => {
              void onRefresh();
            }}
          />
        ))}
      </section>
      <section className="panel">
        <h2>Complete title coverage</h2>
        {review.scope.files.map((file) => (
          <article key={file.assetId}>
            <h3>
              {review.scope.media
                .filter((media) => file.mediaIds.includes(media.id))
                .map((media) => media.title)
                .join(" · ")}
            </h3>
            <p>{file.subtitles.length} recorded subtitles included.</p>
          </article>
        ))}
      </section>
      <section className="panel">
        <h2>Approve the exact restoration</h2>
        <p>
          This permission reverses only the reviewed interrupted file changes.
          It does not resume the old acquisition, establish missing household
          consent or delete retained newer files.
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
              I reviewed all covered titles, earlier videos, preserved subtitles
              and retained newer bytes. Household holds remain in force.
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
                : "Approve this exact predecessor restoration"}
            </button>
          </>
        )}
        <RecoveryProofDetails
          planHash={review.planHash}
          expiresAt={review.expiresAt}
        >
          <p>
            Recorded changes:{" "}
            {review.plan?.files.acknowledgedEffects.length ??
              "Pending inspection"}
            . Exact inverse steps:{" "}
            {review.plan?.files.steps.length ?? "Pending inspection"}.
          </p>
        </RecoveryProofDetails>
      </section>
    </>
  );
}
