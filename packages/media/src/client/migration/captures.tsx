import { useRef, useState } from "react";
import { Link } from "react-router";
import {
  useMutation,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { z } from "zod";
import type { MediaUser } from "#shared/contract.ts";
import { CommandResultSchema } from "#shared/api.ts";
import {
  MigrationProposalSchema,
  type MigrationProposalListSchema,
} from "#shared/migration.ts";
import { queryClient, readApi, writeApi } from "#client/api.ts";
import { Button } from "#client/ui/button.tsx";
import { ConfirmDialog } from "#client/ui/confirm-dialog.tsx";
import { DataList, DataRow } from "#client/ui/data-list.tsx";
import { Badge, Callout, LoadError } from "#client/ui/feedback.tsx";
import { CheckboxField } from "#client/ui/forms/field.tsx";
import { EmptyNote, Panel, SkeletonRows } from "#client/ui/panel.tsx";
import {
  Decision,
  Facts,
  TechnicalDetails,
  Code,
} from "#client/ui/workflow.tsx";
import { MigrationDiscovery } from "./discovery.tsx";
import { ReviewFailure } from "./failure.tsx";
import { RecordList, RecordRow } from "./records.tsx";
import { REVIEW_STATUS, SOURCE_LABELS, when } from "./vocabulary.ts";
import styles from "./migration.module.css";
import { classNames } from "#client/ui/class-names.ts";

const cx = classNames(styles);

type Proposal = z.infer<typeof MigrationProposalSchema>;
export type Captures = z.infer<typeof MigrationProposalListSchema>;

/** Step 2: the captures Media holds, each to be reviewed before it counts. */
export function CapturesSection({
  captures,
  selected,
  onSelect,
  user,
}: {
  captures: UseQueryResult<Captures>;
  selected: string | null;
  onSelect: (id: string) => void;
  user: MediaUser;
}) {
  return (
    <>
      <Panel
        id="captures"
        title="2. Review each capture"
        description={
          <p>
            Open a capture to see what it holds and how each record maps to your
            library. Approving saves your review. It does not pause another
            manager, adopt files, change torrents, or enable automation.
            Protected entries need more evidence.
          </p>
        }
      >
        {captures.isPending && (
          <SkeletonRows label="Loading captures" rows={3} />
        )}
        {captures.error !== null && (
          <LoadError
            what="Captures"
            error={captures.error}
            retry={() => {
              void captures.refetch();
            }}
          />
        )}
        {captures.data?.length === 0 && (
          <EmptyNote>
            No captures yet. Existing library ownership is unchanged. Add one in
            step 1.
          </EmptyNote>
        )}
        {captures.data !== undefined && captures.data.length > 0 && (
          <DataList label="Captures">
            {captures.data.map((capture) => {
              const status = REVIEW_STATUS[capture.status];
              const name = `${SOURCE_LABELS[capture.source.kind]} ${capture.source.version}`;
              return (
                <DataRow
                  key={capture.id}
                  title={name}
                  detail={`Captured ${when(capture.createdAt)}`}
                  status={<Badge tone={status.tone}>{status.label}</Badge>}
                  actions={
                    <Button
                      aria-label={`Review the ${name} capture from ${when(capture.createdAt)}`}
                      aria-pressed={selected === capture.id}
                      onClick={() => {
                        onSelect(capture.id);
                      }}
                    >
                      {selected === capture.id ? "Reviewing" : "Review"}
                    </Button>
                  }
                />
              );
            })}
          </DataList>
        )}
      </Panel>
      {selected !== null && (
        <CaptureDetail key={selected} id={selected} user={user} />
      )}
    </>
  );
}

function CaptureDetail({ id, user }: { id: string; user: MediaUser }) {
  const [notice, setNotice] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ["migration", id],
    queryFn: async () =>
      readApi(`/admin/migration/${id}`, MigrationProposalSchema),
  });
  if (detail.isPending) {
    return (
      <Panel title="Capture review">
        <SkeletonRows label="Loading the capture" rows={4} tall />
      </Panel>
    );
  }
  if (detail.error !== null) {
    return (
      <Panel title="Capture review">
        <LoadError
          what="The capture"
          error={detail.error}
          retry={() => {
            void detail.refetch();
          }}
        />
      </Panel>
    );
  }
  return (
    <CaptureReview
      key={`${id}:${String(detail.data.version)}`}
      proposal={detail.data}
      user={user}
      notice={notice}
      onRecorded={setNotice}
    />
  );
}

function CaptureReview({
  proposal,
  user,
  notice,
  onRecorded,
}: {
  proposal: Proposal;
  user: MediaUser;
  notice: string | null;
  onRecorded: (message: string) => void;
}) {
  const entries = proposal.report.entries;
  const protectedCount = entries.filter(
    (entry) => entry.state !== "adoptable_evidence_ready",
  ).length;
  const status = REVIEW_STATUS[proposal.status];
  const whole = proposal.report.complete && proposal.report.stable;
  const source = SOURCE_LABELS[proposal.source.kind];
  return (
    <Panel
      id="capture-review"
      title={`Review: ${source}, captured ${when(proposal.createdAt)}`}
    >
      <Callout tone={status.tone} title={status.label}>
        {status.meaning}
      </Callout>
      {notice !== null && (
        <Callout tone="ok">
          <span role="status">{notice}</span>
        </Callout>
      )}
      <Facts
        items={[
          { name: "Source", value: `${source} ${proposal.source.version}` },
          { name: "Records", value: String(entries.length) },
          { name: "Protected records", value: String(protectedCount) },
          {
            name: "Capture",
            value: whole
              ? "Complete and stable"
              : "Incomplete or changing source",
          },
        ]}
      />
      <p>
        <Link
          to={`/recovery?captureId=${encodeURIComponent(proposal.captureId)}`}
        >
          Match captured requesters to exact household identities
        </Link>
        . Matching identities alone creates no demand and no ownership.
      </p>
      <MigrationDiscovery proposal={proposal} actorId={user.id} />
      <section className={cx("subsection")}>
        <h3>Records in this capture</h3>
        <p>None of these records is owned yet.</p>
        <RecordList
          entries={entries}
          label="Captured records"
          empty="This capture holds no records."
          row={(entry) => (
            <RecordRow
              key={entry.provenanceKey}
              entry={entry}
              note="Ready for a separately verified handoff."
            />
          )}
        />
      </section>
      <TechnicalDetails>
        <p>
          Source instance <Code>{proposal.source.instanceId}</Code>
        </p>
        <p>
          Capture hash <Code>{proposal.captureHash}</Code>
        </p>
        <p>
          Report hash <Code>{proposal.reportHash}</Code>
        </p>
        <p>
          Recovery epoch {proposal.recoveryEpoch} (it changes when the household
          is restored from a backup), runtime version {proposal.runtimeVersion},
          review version {proposal.version}.
        </p>
      </TechnicalDetails>
      <CaptureDecision
        proposal={proposal}
        user={user}
        source={source}
        onRecorded={onRecorded}
      />
    </Panel>
  );
}

/** Approve a capture that waits for review, or revoke one that was approved. */
function CaptureDecision({
  proposal,
  user,
  source,
  onRecorded,
}: {
  proposal: Proposal;
  user: MediaUser;
  source: string;
  onRecorded: (message: string) => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const confirmRevoke = useRef<HTMLDialogElement>(null);
  const review = useMutation({
    mutationFn: async (action: "approve" | "revoke") =>
      writeApi({
        actorId: user.id,
        path: `/admin/migration/${proposal.id}/review`,
        body: {
          action,
          expectedVersion: proposal.version,
          reportHash: proposal.reportHash,
          captureHash: proposal.captureHash,
          recoveryEpoch: proposal.recoveryEpoch,
          runtimeVersion: proposal.runtimeVersion,
          acknowledgeNoOwnershipTransfer: true,
        },
        schema: CommandResultSchema,
      }),
    onSuccess: async (_result, action) => {
      onRecorded(
        action === "approve"
          ? "Approval recorded. This capture counts as reviewed. No ownership was transferred."
          : "Approval revoked. This capture no longer counts as reviewed.",
      );
      await queryClient.invalidateQueries({ queryKey: ["migration"] });
    },
  });
  return (
    <>
      {proposal.status === "awaiting_review" && (
        <Decision title="Record your approval">
          <p>
            Approving saves that you reviewed this evidence. It does not
            transfer ownership of any record.
          </p>
          <CheckboxField
            label="I reviewed this evidence and understand this does not transfer ownership."
            checked={acknowledged}
            onChange={(event) => {
              setAcknowledged(event.currentTarget.checked);
            }}
          />
          <div>
            <Button
              variant="primary"
              disabled={!acknowledged}
              busy={review.isPending}
              onClick={() => {
                review.mutate("approve");
              }}
            >
              {review.isPending ? "Recording approval…" : "Record approval"}
            </Button>
          </div>
        </Decision>
      )}
      {proposal.status === "approved" && (
        <Decision title="Revoke your approval">
          <p>
            Revoking saves that you no longer approve this capture. This page
            has no way to approve it again; upload a fresh capture to start a
            new review.
          </p>
          <div>
            <Button
              busy={review.isPending}
              onClick={() => {
                confirmRevoke.current?.showModal();
              }}
            >
              {review.isPending ? "Revoking approval…" : "Revoke approval"}
            </Button>
          </div>
        </Decision>
      )}
      <ConfirmDialog
        ref={confirmRevoke}
        title={`Revoke approval of the ${source} capture?`}
        confirmLabel="Revoke approval"
        danger
        onConfirm={() => {
          review.mutate("revoke");
        }}
      >
        <p>
          Your approval of the {source} capture from {when(proposal.createdAt)}{" "}
          will be withdrawn. This page has no way to approve it again; upload a
          fresh capture to start a new review.
        </p>
      </ConfirmDialog>
      {review.error !== null && (
        <ReviewFailure
          error={review.error}
          verb={review.variables === "revoke" ? "revocation" : "approval"}
          queryKey={["migration"]}
        />
      )}
    </>
  );
}
