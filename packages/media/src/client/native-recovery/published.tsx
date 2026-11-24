import { Link } from "react-router";
import type { z } from "zod";
import type { NativeLifecycleDetailSchema } from "#shared/native-recovery/lifecycle.ts";
import { DataList, DataRow } from "#client/ui/data-list.tsx";
import { Badge } from "#client/ui/feedback.tsx";
import { Panel } from "#client/ui/panel.tsx";
import { Code, Effects } from "#client/ui/workflow.tsx";
import { QuarantineContinuations } from "./continuations.tsx";
import {
  ApprovalSection,
  ProofDetails,
  ReviewHeader,
  StatePanel,
} from "./shell.tsx";
import { coveredTitles, phrase } from "./vocabulary.ts";

type Detail = z.infer<typeof NativeLifecycleDetailSchema>;
type Policies = Extract<
  Detail["scope"],
  { subtitlePolicies: unknown }
>["subtitlePolicies"];

export type Approval = {
  acknowledged: boolean;
  onAcknowledge: (value: boolean) => void;
  onApply: () => void;
  pending: boolean;
  error: Error | null;
};
export type Header = {
  onRefresh: () => void;
  refreshing: boolean;
  loadError: Error | null;
};

/**
 * Reprove the physical ownership of files a restore left unproven: published
 * files, or files that were in quarantine. Approving renews ownership of
 * exactly the reviewed versions and nothing about the household's choices.
 */
export function PublishedReview({
  review,
  quarantined,
  subtitlePolicies,
  approval,
  header,
}: {
  review: Detail;
  quarantined: boolean;
  subtitlePolicies: Policies;
  approval: Approval;
  header: Header;
}) {
  const kind = quarantined ? "quarantined" : "installed";
  const files = review.scope.files.length;
  return (
    <>
      <ReviewHeader
        title={
          quarantined
            ? "Recover quarantined file ownership"
            : "Recover selected file ownership"
        }
        intro="File checks prove these physical versions. They cannot recover household choices lost after the backup."
        back={{
          to: "/manage/recovery/native",
          label: "All native recovery reviews",
        }}
        refreshLabel="Refresh review"
        {...header}
      />
      <StatePanel state={review.state}>
        {quarantined && (
          <p>
            Approval preserves quarantine, subtitle quality, and existing
            retention history. Files stay in quarantine until current household
            intent authorizes restoration. This does not prove anyone watched
            them or permit deletion.
          </p>
        )}
        {review.state === "applied" && (
          <p>
            Physical ownership is restored. Household protection remains active.{" "}
            <Link to="/recovery">Review current household intent</Link> before
            releasing the selected recovery holds.
          </p>
        )}
      </StatePanel>
      <QuarantineContinuations items={review.continuations} />
      <Panel id="titles" title="Affected titles">
        <DataList label="Affected titles">
          {review.scope.files.map((file) => (
            <DataRow
              key={file.assetId}
              title={coveredTitles(review.scope.media, file.mediaIds)}
              detail={
                <>
                  <p>
                    {file.subtitles.length} {kind} subtitle
                    {file.subtitles.length === 1 ? "" : "s"} included. Their
                    accepted, unverified, or rejected quality status is
                    preserved.
                  </p>
                  {file.subtitles.map((subtitle) => (
                    <p key={subtitle.id}>
                      {subtitle.language}, {phrase(subtitle.storageKind)},{" "}
                      {phrase(subtitle.qualityStatus).toLowerCase()}
                    </p>
                  ))}
                </>
              }
            />
          ))}
        </DataList>
      </Panel>
      <Panel
        id="policies"
        title={
          review.state === "applied"
            ? "Subtitle policies renewed"
            : "Subtitle policies to be renewed"
        }
      >
        <DataList label="Subtitle policies">
          {subtitlePolicies.map((policy) => (
            <DataRow
              key={policy.mediaId}
              title={
                review.scope.media.find((media) => media.id === policy.mediaId)
                  ?.title ?? policy.mediaId
              }
              detail={
                policy.effective === null ? (
                  <p>No restored policy; no policy authority will be added.</p>
                ) : (
                  <>
                    {policy.effective.rules.targets.map((target, index) => (
                      <p key={`${target.language}:${String(index)}`}>
                        {target.language},{" "}
                        {target.forced ? "forced subtitles" : "full subtitles"},
                        hearing impaired:{" "}
                        {phrase(target.hearingImpaired).toLowerCase()}, audio
                        condition: {phrase(target.audio).toLowerCase()}; policy
                        audio language: {target.audioLanguage}
                      </p>
                    ))}
                    {policy.effective.rules.protectedReasons.length > 0 && (
                      <p>
                        Preserved blockers:{" "}
                        {policy.effective.rules.protectedReasons
                          .map((reason) => phrase(reason).toLowerCase())
                          .join("; ")}
                      </p>
                    )}
                  </>
                )
              }
              status={
                policy.effective === null ? (
                  <Badge>No policy</Badge>
                ) : review.state === "applied" ? (
                  <Badge tone="ok">Renewed</Badge>
                ) : (
                  <Badge>Will be renewed</Badge>
                )
              }
            />
          ))}
        </DataList>
      </Panel>
      <Panel id="changes" title="What this approval changes">
        <Effects
          will={[
            `Renews ownership only for the exact reviewed videos and ${kind} subtitle files.`,
            "Creates selected-title subtitle policy versions with the reviewed rules; other titles keep their prior policies.",
          ]}
          wontTitle="What stays as it is"
          wont={[
            "Recovery holds, personal Keep choices, and pins stay in force. Existing work and delivery history is preserved.",
            "New acquisition still needs a current authorized request or an explicit positive household declaration.",
            ...(quarantined
              ? [
                  "Restoration requires current positive authority for every covered leaf. Mixed positive and negative demand on a shared file remains protected; a negative declaration never authorizes restoration or deletion.",
                ]
              : []),
          ]}
        />
        {review.state === "awaiting_review" && (
          <ApprovalSection
            summary={
              <p>
                Approving renews physical ownership of {files} file
                {files === 1 ? "" : "s"}. Missing household history remains
                protected.
              </p>
            }
            acknowledgement="I reviewed these titles, subtitle policies and physical proofs. I understand missing household history remains protected."
            buttonLabel="Apply this exact physical review"
            confirmTitle="Renew file ownership?"
            confirmLabel="Renew ownership"
            confirmBody={
              <p>
                Media will record physical ownership of {files} file
                {files === 1 ? "" : "s"} and create subtitle policy versions for
                the selected titles. Recovery holds, Keep choices, and pins stay
                in force. This page cannot undo it.
              </p>
            }
            {...approval}
            onRefresh={header.onRefresh}
          />
        )}
        <ProofDetails planHash={review.planHash} expiresAt={review.expiresAt}>
          {review.scope.files.map((file) => (
            <p key={file.assetId}>
              <Code>{file.canonicalPath}</Code>
              <br />
              Recorded SHA-256 <Code>{file.checksum}</Code>
            </p>
          ))}
          <p>Selected policy snapshots: {subtitlePolicies.length}.</p>
        </ProofDetails>
      </Panel>
    </>
  );
}
