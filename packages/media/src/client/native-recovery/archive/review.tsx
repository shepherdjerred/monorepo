import type { z } from "zod";
import type { NativeLifecycleDetailSchema } from "#shared/native-recovery/lifecycle.ts";
import type { NativeArchiveScope } from "#shared/native-recovery/archive.ts";
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
import { phrase, when } from "#client/native-recovery/vocabulary.ts";
import { archiveBytes, archiveReasons, archiveRoles } from "./presentation.ts";

type Detail = z.infer<typeof NativeLifecycleDetailSchema>;

/** Resume expiry cleanup for the old versions the owner selected. Approval itself deletes nothing. */
export function NativeArchiveReview({
  review,
  scope,
  approval,
  header,
}: {
  review: Detail;
  scope: NativeArchiveScope;
  approval: Approval;
  header: Header;
}) {
  const selected = scope.edges.filter((edge) => edge.selected).length;
  return (
    <>
      <ReviewHeader
        title="Resume archive expiry cleanup"
        intro="Only the explicitly selected old versions can become eligible for expiry cleanup. Current playback and unselected archives remain retained."
        back={{
          to: "/manage/recovery/native/archives",
          label: "All upgrade archives",
        }}
        refreshLabel="Refresh current protection and cleanup status"
        {...header}
      />
      <StatePanel state={review.state}>
        <p>
          Approval itself deletes nothing. The original deadlines, subtitle
          quality, and historical work remain unchanged. Fresh playback,
          content, and household checks are required before cleanup.
        </p>
        {review.state === "applied" && (
          <p>
            Physical responsibility is recorded. Newly recovered titles retain
            recovery holds; unchanged prior grants do not renew them. Review
            current household intent separately.
          </p>
        )}
      </StatePanel>
      <Panel id="files" title="Selected and retained files">
        <DataList label="Selected and retained files">
          {scope.files.map((file) => (
            <DataRow
              key={file.assetId}
              title={archiveRoles[file.role]}
              detail={
                <>
                  <p>
                    {scope.media
                      .filter((media) => file.mediaIds.includes(media.id))
                      .map((media) => media.title)
                      .join(", ")}
                  </p>
                  <p>
                    {archiveBytes(file.sizeBytes)}, {file.subtitles.length}{" "}
                    subtitle record{file.subtitles.length === 1 ? "" : "s"}.
                    Quality and provenance are preserved.
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
                        {edge.selected
                          ? "Selected cleanup"
                          : "Retained dependency"}
                        . Original expiry: {when(edge.expiresAt)}
                      </p>
                    ))}
                </>
              }
            />
          ))}
        </DataList>
      </Panel>
      {scope.supersessions !== undefined && (
        <Panel id="superseded" title="Replace stopped cleanup approvals">
          <p>
            This review replaces {scope.supersessions.length} earlier cleanup
            approval{scope.supersessions.length === 1 ? "" : "s"} after a
            recorded upgrade. Earlier workers must have stopped, all retained
            files must be unchanged, and no earlier purge may have begun. The
            original expiry deadlines remain unchanged.
          </p>
        </Panel>
      )}
      {scope.terminalDependencies.length > 0 && (
        <Panel id="removed" title="Already removed dependencies">
          <p>
            {scope.terminalDependencies.length} completed cleanup record
            {scope.terminalDependencies.length === 1 ? "" : "s"} must match
            fresh absence and journal proofs. They are not adopted or selected
            again.
          </p>
        </Panel>
      )}
      {(review.archiveContinuations?.length ?? 0) > 0 && (
        <Panel id="status" title="Expiry cleanup status">
          <DataList label="Expiry cleanup status">
            {review.archiveContinuations?.map((item) => (
              <DataRow
                key={item.id}
                title={item.titles.join(", ")}
                detail={
                  <>
                    <p>
                      {phrase(item.state)}. Original expiry:{" "}
                      {when(item.expiresAt)}
                    </p>
                    {item.state === "superseded" && (
                      <p>
                        A newer exact review replaced this stopped approval.
                        This approval cannot restart or delete files; it is not
                        a cleanup completion.
                      </p>
                    )}
                    {item.reasons.map((reason) => (
                      <p key={reason}>{archiveReasons[reason]}</p>
                    ))}
                  </>
                }
              />
            ))}
          </DataList>
        </Panel>
      )}
      <Panel id="changes" title="What this approval permits">
        <Effects
          will={[
            "Resumes only the selected archive expiry cleanup, after its original deadline and once all current protections clear.",
          ]}
          wontTitle="What stays as it is"
          wont={[
            "Current playable versions and dependency-only archives are retained.",
            "Keep choices, pins, and current demand are preserved. Ownership proof is not a household declaration.",
          ]}
        />
        <p>
          A later upgrade needs its exact durable publication record and proof
          that earlier cleanup stopped without effects. Missing records or
          incomplete effects remain protected; another review cannot override
          them.
        </p>
        {review.state === "awaiting_review" && (
          <ApprovalSection
            summary={
              <p>
                Approving makes {selected} selected old version
                {selected === 1 ? "" : "s"} eligible for expiry cleanup once
                their deadlines pass. It deletes nothing now.
              </p>
            }
            acknowledgement="I reviewed the selected cleanups, retained files and original deadlines. Household and playback protections still apply."
            buttonLabel="Resume archive expiry cleanup"
            confirmTitle="Resume expiry cleanup?"
            confirmLabel="Resume cleanup"
            confirmBody={
              <p>
                {selected} selected old version{selected === 1 ? "" : "s"} can
                be cleaned up after the original deadlines and once household
                and playback protections clear. Approval itself deletes nothing,
                and this page cannot undo it.
              </p>
            }
            {...approval}
          />
        )}
        <ProofDetails planHash={review.planHash} expiresAt={review.expiresAt}>
          {scope.files.map((file) => (
            <p key={file.assetId}>
              <Code>{file.canonicalPath}</Code>
              <br />
              SHA-256 <Code>{file.checksum}</Code>
            </p>
          ))}
        </ProofDetails>
      </Panel>
    </>
  );
}
