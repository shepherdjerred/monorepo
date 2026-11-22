import type { z } from "zod";
import type { NativeCompensationScope } from "#shared/native-recovery/compensation.ts";
import { FinishedNativeCompensationSchema } from "#shared/native-recovery/compensation.ts";
import type { NativeLifecycleDetailSchema } from "#shared/native-recovery/lifecycle.ts";
import type { MediaUser } from "#shared/contract.ts";
import { DataList, DataRow } from "#client/ui/data-list.tsx";
import { Panel } from "#client/ui/panel.tsx";
import { Code, Effects } from "#client/ui/workflow.tsx";
import type { Approval, Header } from "#client/native-recovery/published.tsx";
import {
  ApprovalSection,
  ProofDetails,
  ReviewHeader,
  StatePanel,
} from "#client/native-recovery/shell.tsx";
import { CompensationStatus } from "./status.tsx";

/** Restore the predecessor files of an interrupted upgrade, keeping the successor's bytes. */
export function NativeCompensationReview({
  user,
  review,
  scope,
  approval,
  header,
}: {
  user: MediaUser;
  review: z.infer<typeof NativeLifecycleDetailSchema>;
  scope: NativeCompensationScope;
  approval: Approval;
  header: Header;
}) {
  const plan =
    review.plan === null
      ? null
      : FinishedNativeCompensationSchema.parse(review.plan);
  const continuations = review.compensationContinuations ?? [];
  return (
    <>
      <ReviewHeader
        title="Restore reviewed predecessor files"
        intro="Restore the earlier files and their installed subtitles while retaining successor bytes. This does not establish whether a successor was published after the backup."
        back={{
          to: "/manage/recovery/native/compensations",
          label: "All interrupted upgrades",
        }}
        refreshLabel="Refresh restoration and playback status"
        {...header}
      />
      <StatePanel state={review.state}>
        <p>
          Approval authorizes only the reviewed restoration. It changes no files
          immediately, does not resume historical work, and cannot release
          household holds.
        </p>
      </StatePanel>
      <Panel id="coverage" title="Complete upgrade coverage">
        <DataList label="Titles in this upgrade">
          {scope.entries.map((entry) => (
            <DataRow
              key={entry.entry.operationId}
              title={scope.media
                .filter((media) => entry.entry.mediaIds.includes(media.id))
                .map((media) => media.title)
                .join(", ")}
              detail={
                <p>
                  Restore the predecessor and preserve{" "}
                  {entry.predecessor?.subtitles.filter(
                    (subtitle) => subtitle.state === "installed",
                  ).length ?? 0}{" "}
                  installed subtitle records with their recorded quality and
                  provenance. Retain successor bytes; no retained artifact is
                  selected for deletion.
                </p>
              }
            />
          ))}
        </DataList>
      </Panel>
      {continuations.length > 0 && (
        <Panel id="restoration" title="Restoration and playback">
          <DataList label="Restoration status">
            {continuations.map((item) => (
              <CompensationStatus
                key={item.id}
                user={user}
                item={item}
                onRefresh={header.onRefresh}
              />
            ))}
          </DataList>
        </Panel>
      )}
      <Panel id="changes" title="What this approval permits">
        <Effects
          will={[
            "Reverses only the exactly recorded changes for this complete upgrade.",
          ]}
          wontTitle="What stays as it is"
          wont={[
            "Successor files and new subtitle candidates are retained for recovery; nothing is deleted or automatically replaced.",
            "Historical work, personal Keep choices, pins, and household protection are preserved.",
          ]}
        />
        {review.state === "awaiting_review" && (
          <ApprovalSection
            summary={
              <p>
                Approving authorizes this exact restoration of the earlier
                files. It changes no files immediately.
              </p>
            }
            acknowledgement="I reviewed the predecessor restoration, retained successor bytes and complete title coverage. Household holds remain in force."
            buttonLabel="Approve this exact predecessor restoration"
            confirmTitle="Approve this predecessor restoration?"
            confirmLabel="Approve restoration"
            confirmBody={
              <p>
                The earlier files of {scope.entries.length} upgrade
                {scope.entries.length === 1 ? "" : "s"} will be authorized for
                restoration, with successor bytes retained. Household holds stay
                in force. This page cannot undo it.
              </p>
            }
            {...approval}
          />
        )}
        <ProofDetails planHash={review.planHash} expiresAt={review.expiresAt}>
          <p>
            Acknowledged effects:{" "}
            {plan?.files.acknowledgedEffects.length ?? "pending inspection"}.
            Exact inverse steps:{" "}
            {plan?.files.steps.length ?? "pending inspection"}.
          </p>
          {scope.entries.map((entry) => (
            <p key={entry.entry.operationId}>
              <Code>{entry.predecessor?.path}</Code>
              <br />
              Predecessor SHA-256 <Code>{entry.predecessor?.checksum}</Code>
              <br />
              Retained successor SHA-256 <Code>{entry.entry.checksum}</Code>
            </p>
          ))}
        </ProofDetails>
      </Panel>
    </>
  );
}
