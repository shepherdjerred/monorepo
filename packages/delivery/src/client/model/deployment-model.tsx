import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type {
  ApprovalV2,
  DeploymentDetailV2,
  RecoveryIntentV2,
} from "#shared/model/contract.ts";
import { queries } from "#client/queries.ts";
import { Status } from "#client/components/status.tsx";
import { RelativeTime } from "#client/components/time.tsx";
import {
  DeploymentLink,
  QueryPanel,
  SelectionFacts,
} from "./selection-facts.tsx";

function FrozenSelection({ detail }: { detail: DeploymentDetailV2 }) {
  const { deployment } = detail;
  return (
    <section className="panel" aria-labelledby="selection-heading">
      <h2 id="selection-heading">Selection</h2>
      {deployment.selection === null ? (
        <p className="empty">This deployment froze no selection.</p>
      ) : (
        <SelectionFacts selection={deployment.selection} />
      )}
      {deployment.restoredDeploymentId !== null && (
        <p>
          Restores the selection accepted by{" "}
          <DeploymentLink id={deployment.restoredDeploymentId} />.
        </p>
      )}
      {deployment.monitorState !== null && (
        <p>
          Monitor <Status value={deployment.monitorState} />
        </p>
      )}
    </section>
  );
}

function PreviousSelection({ previousId }: { previousId: string | null }) {
  const previous = useQuery({
    ...queries.deployment(previousId ?? ""),
    enabled: previousId !== null,
  });
  if (previousId === null)
    return (
      <section className="panel" aria-labelledby="previous-heading">
        <h2 id="previous-heading">Previous accepted selection</h2>
        <p className="empty">
          None: the environment had no accepted selection when this deployment
          was requested.
        </p>
      </section>
    );
  return (
    <QueryPanel
      id="previous"
      title="Previous accepted selection"
      query={previous}
    >
      {(detail) => (
        <>
          {detail.deployment.selection === null ? (
            <p className="empty">That deployment froze no selection.</p>
          ) : (
            <SelectionFacts selection={detail.deployment.selection} />
          )}
          <p>
            Accepted by <DeploymentLink id={previousId} />
          </p>
        </>
      )}
    </QueryPanel>
  );
}

/** The approval of the frozen selection (4.13), including expiry and override. */
function ApprovalRecord({ approval }: { approval: ApprovalV2 }) {
  return (
    <section className="panel" aria-labelledby="approval-heading">
      <h2 id="approval-heading">Approval</h2>
      <p className="detail-summary">
        <Status value={approval.status} />
        {approval.override && (
          <span className="badge badge-override">Override</span>
        )}
      </p>
      <dl className="facts">
        <div>
          <dt>Approver</dt>
          <dd>{approval.actor ?? "Not decided"}</dd>
        </div>
        <div>
          <dt>Requested</dt>
          <dd>
            <RelativeTime value={approval.createdAt} />
          </dd>
        </div>
        <div>
          <dt>Settled</dt>
          <dd>
            {approval.decidedAt === null ? (
              "Pending"
            ) : (
              <RelativeTime value={approval.decidedAt} />
            )}
          </dd>
        </div>
      </dl>
      {approval.reason !== null && <p>{approval.reason}</p>}
      {approval.status === "expired" && (
        <p className="notice">
          This approval expired: the environment&apos;s binding generation moved
          after the request, so it no longer binds the frozen selection.
        </p>
      )}
      {approval.override && (
        <p className="muted">
          The frozen set revision is not eligible for an ordinary deploy, so a
          decision is recorded as an override.
        </p>
      )}
    </section>
  );
}

/** Kinds whose own panel on the deployment page shows the intent with its native evidence. */
const SPECIALIZED_RECOVERY = new Set<RecoveryIntentV2["kind"]>([
  "minecraft",
  "platform",
  "content",
]);

function RecoveryIntents({
  intents,
  recoveryRequired,
}: {
  intents: RecoveryIntentV2[];
  recoveryRequired: boolean;
}) {
  if (!recoveryRequired && intents.length === 0) return null;
  return (
    <section className="panel" aria-labelledby="intents-heading">
      <h2 id="intents-heading">Recovery intents</h2>
      {intents.length === 0 ? (
        <p className="empty">
          No inspection has been requested. An administrator creates a recovery
          intent; the deployment keeps its locks until an independent reader
          settles one.
        </p>
      ) : (
        <ol className="intents">
          {intents
            .toSorted((left, right) => left.sequence - right.sequence)
            .map((intent) => (
              <li key={intent.id}>
                <Link to="/recovery-intents/$" params={{ _splat: intent.id }}>
                  Intent {intent.sequence}
                </Link>{" "}
                <Status value={intent.outcome} /> {intent.kind}
                {intent.step !== null && ` · step ${intent.step}`} ·{" "}
                <RelativeTime value={intent.createdAt} />
              </li>
            ))}
        </ol>
      )}
    </section>
  );
}

/** What a deployment froze and moved away from, its approval and recovery (4.9, 4.13, 4.15). */
export function DeploymentModel({ detail }: { detail: DeploymentDetailV2 }) {
  return (
    <>
      <div className="detail-grid">
        <FrozenSelection detail={detail} />
        <PreviousSelection
          previousId={detail.deployment.previousAcceptedDeploymentId}
        />
      </div>
      {detail.approval !== null && (
        <ApprovalRecord approval={detail.approval} />
      )}
      <RecoveryIntents
        intents={detail.recoveryIntents.filter(
          (intent) => !SPECIALIZED_RECOVERY.has(intent.kind),
        )}
        recoveryRequired={
          detail.deployment.recoveryRequired &&
          detail.minecraftRecoveries.length === 0 &&
          detail.platformRecoveries.length === 0 &&
          detail.contentRecoveries.length === 0
        }
      />
    </>
  );
}
