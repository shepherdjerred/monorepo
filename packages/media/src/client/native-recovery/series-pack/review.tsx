import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import type { MediaUser } from "#shared/contract.ts";
import type {
  NativeRecoveryDetailProtocolSchema,
  SeriesPackNativeDetailV1,
} from "#shared/native-recovery/series-pack/detail.ts";
import { CommandResultSchema } from "#shared/api.ts";
import { writeApi } from "#client/api.ts";
import { DataList, DataRow } from "#client/ui/data-list.tsx";
import { Panel } from "#client/ui/panel.tsx";
import { Effects } from "#client/ui/workflow.tsx";
import {
  ApprovalSection,
  ProofDetails,
  ReviewHeader,
  StatePanel,
} from "#client/native-recovery/shell.tsx";
import { coveredTitles } from "#client/native-recovery/vocabulary.ts";
import { nativeReviewAcknowledged } from "#client/native-recovery/acknowledgement.ts";
import { CompensationStatus } from "#client/native-recovery/compensation/status.tsx";

export function SeriesPackNativeReview({
  user,
  review,
  acknowledgement,
  onAcknowledge,
  onRefresh,
  refreshing,
  loadError,
}: {
  user: MediaUser;
  review: SeriesPackNativeDetailV1;
  acknowledgement: string | null;
  onAcknowledge: (checked: boolean) => void;
  onRefresh: () => Promise<unknown>;
  refreshing: boolean;
  loadError: Error | null;
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
  const files = review.scope.files.length;
  return (
    <>
      <ReviewHeader
        title="Restore the reviewed earlier TV files"
        intro="Review every file in this interrupted upgrade. Restoration preserves the earlier subtitles and retains the newer bytes for recovery."
        back={{
          to: "/manage/recovery/native/compensations",
          label: "All interrupted upgrades",
        }}
        refreshLabel="Refresh restoration and playback status"
        onRefresh={() => {
          void onRefresh();
        }}
        refreshing={refreshing}
        loadError={loadError}
      />
      <StatePanel state={review.state}>
        <p>
          {files} earlier video{files === 1 ? "" : "s"} and {captionCount}{" "}
          recorded subtitle{captionCount === 1 ? "" : "s"} are included.
          Subtitle quality and provenance remain as recorded. Approval keeps
          household holds, personal Keep choices, and pins in force.
        </p>
        <p>
          Restored files remain protected until every covered title has current
          positive household authority and Plex verifies the complete group.
        </p>
        <DataList label="Restoration status">
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
        </DataList>
      </StatePanel>
      <Panel id="coverage" title="Complete title coverage">
        <DataList label="Titles in this upgrade">
          {review.scope.files.map((file) => (
            <DataRow
              key={file.assetId}
              title={coveredTitles(review.scope.media, file.mediaIds)}
              detail={
                <p>{file.subtitles.length} recorded subtitles included.</p>
              }
            />
          ))}
        </DataList>
      </Panel>
      <Panel id="changes" title="Approve the exact restoration">
        <Effects
          will={["Reverses only the reviewed interrupted file changes."]}
          wontTitle="What stays as it is"
          wont={[
            "The old acquisition is not resumed.",
            "Missing household consent is not established.",
            "Retained newer files are not deleted.",
          ]}
        />
        {review.state === "awaiting_review" && (
          <ApprovalSection
            summary={
              <p>
                Approving authorizes restoring {files} earlier video
                {files === 1 ? "" : "s"} with their preserved subtitles.
              </p>
            }
            acknowledgement="I reviewed all covered titles, earlier videos, preserved subtitles and retained newer bytes. Household holds remain in force."
            acknowledged={acknowledged}
            onAcknowledge={onAcknowledge}
            buttonLabel="Approve this exact predecessor restoration"
            confirmTitle="Approve this restoration?"
            confirmLabel="Approve restoration"
            confirmBody={
              <p>
                {files} earlier video{files === 1 ? "" : "s"} and {captionCount}{" "}
                subtitle{captionCount === 1 ? "" : "s"} will be authorized for
                restoration, with the newer bytes retained. Household holds stay
                in force. This page cannot undo it.
              </p>
            }
            onApply={() => {
              apply.mutate();
            }}
            pending={apply.isPending}
            error={apply.error}
          />
        )}
        <ProofDetails planHash={review.planHash} expiresAt={review.expiresAt}>
          <p>
            Recorded changes:{" "}
            {review.plan?.files.acknowledgedEffects.length ??
              "pending inspection"}
            . Exact inverse steps:{" "}
            {review.plan?.files.steps.length ?? "pending inspection"}.
          </p>
        </ProofDetails>
      </Panel>
    </>
  );
}
