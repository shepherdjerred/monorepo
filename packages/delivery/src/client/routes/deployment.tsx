import { Link, createRoute, useNavigate } from "@tanstack/react-router";
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import {
  argocdApplicationLink,
  temporalWorkflowLink,
} from "@shepherdjerred/ops-model/tool-links.ts";
import { deliveryWorkflowId } from "#shared/contract.ts";
import type { Deployment, DeploymentDetail } from "#shared/contract.ts";
import { delivery } from "#client/api.ts";
import { queries } from "#client/queries.ts";
import { PageHeader } from "#client/components/page-header.tsx";
import { Status } from "#client/components/status.tsx";
import { RelativeTime } from "#client/components/time.tsx";
import { ToolLinks } from "#client/components/links.tsx";
import { ConfirmButton } from "#client/components/confirm-dialog.tsx";
import { ErrorNotice } from "#client/components/notices.tsx";
import { ApprovalForm } from "#client/forms/approval-form.tsx";
import { DeploymentRecord, sourceLabel } from "#client/deployment-detail.tsx";
import type { RecoveryDecision } from "#client/platform-recovery.tsx";
import { canApprove, canDeploy, isTerminal } from "#client/presentation.ts";
import { Route as rootRoute } from "./root.tsx";

type Action =
  | { kind: "cancel" | "retry" }
  | ({ kind: "recovery-decision" } & RecoveryDecision);

async function perform(detail: DeploymentDetail, action: Action) {
  const id = detail.deployment.id;
  switch (action.kind) {
    case "cancel": {
      return await delivery.cancel(id);
    }
    case "retry": {
      return await delivery.retry(id, {
        requestId: crypto.randomUUID(),
        expectedGeneration: detail.environment.generation,
      });
    }
    case "recovery-decision": {
      await delivery.approvePlatformRecoveryPlan(action.intentId, {
        planFingerprint: action.planFingerprint,
        decision: action.decision,
        reason: action.reason,
      });
      return detail.deployment;
    }
  }
}

function links(detail: DeploymentDetail) {
  return [
    ...(detail.deployment.status === "awaiting_approval"
      ? []
      : [temporalWorkflowLink(deliveryWorkflowId(detail.deployment.id))]),
    ...(detail.environment.application === null
      ? []
      : [argocdApplicationLink(detail.environment.application)]),
  ];
}

function DeploymentPage() {
  const { deploymentId } = Route.useParams();
  const { data: detail } = useSuspenseQuery(queries.deployment(deploymentId));
  const identity = useQuery(queries.identity());
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  async function settled(deployment: Deployment) {
    await queryClient.invalidateQueries();
    if (deployment.id !== deploymentId)
      await navigate({
        to: "/deployments/$deploymentId",
        params: { deploymentId: deployment.id },
      });
  }
  const action = useMutation({
    mutationFn: (input: Action) => perform(detail, input),
    onSuccess: settled,
  });
  const { deployment, environment } = detail;
  const principal = identity.data;
  const producerRestorationPending = detail.contentRecoveries.some(
    (intent) =>
      intent.dispatchBarrier !== null && intent.barrierRestoredAt === null,
  );
  const retryable =
    ["deploy", "promote", "rollback"].includes(deployment.kind) &&
    ["failed", "canceled"].includes(deployment.status);
  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/environments/$" params={{ _splat: environment.id }}>
            {environment.id}
          </Link>
        }
        title={`Deployment to ${environment.id}`}
        description={
          <span role="status" className="detail-summary">
            <Status value={deployment.status} />
            <span>{deployment.kind}</span>
            <Link
              to="/versions/$versionSetId"
              params={{ versionSetId: detail.versionSet.id }}
            >
              {sourceLabel(detail) === detail.versionSet.id
                ? `Version set r${String(detail.versionSet.revision)}`
                : sourceLabel(detail)}
            </Link>
            <span>
              requested by {deployment.requestedBy}{" "}
              <RelativeTime value={deployment.createdAt} />
            </span>
          </span>
        }
        actions={<ToolLinks links={links(detail)} />}
      />
      {action.error !== null && <ErrorNotice error={action.error} />}
      {deployment.status === "awaiting_approval" &&
        principal !== undefined &&
        (canApprove(principal) ? (
          <ApprovalForm
            key={deployment.id}
            onDecision={async (decision) => {
              // The route answers with the decided approval; the page reads
              // the deployment's new state again.
              await delivery.approve(deployment.id, decision);
              await queryClient.invalidateQueries();
            }}
          />
        ) : (
          <p className="notice">
            A human with approval access must review this deployment.
          </p>
        ))}
      {principal !== undefined && canDeploy(principal) && (
        <div className="button-row detail-actions">
          {!isTerminal(deployment) && (
            <ConfirmButton
              label="Request cancellation"
              title="Cancel this deployment?"
              confirmLabel="Request cancellation"
              danger
              disabled={action.isPending || deployment.cancelRequested}
              onConfirm={() => {
                action.mutate({ kind: "cancel" });
              }}
            >
              <p>
                A queued request stops now. A running one stops at its next safe
                boundary; external work already started is not undone.
              </p>
            </ConfirmButton>
          )}
          {retryable && (
            <ConfirmButton
              label="Retry as a new deployment"
              title="Retry this release?"
              confirmLabel="Request retry"
              disabled={
                action.isPending ||
                deployment.recoveryRequired ||
                producerRestorationPending
              }
              onConfirm={() => {
                action.mutate({ kind: "retry" });
              }}
            >
              <p>
                A new deployment requests the same version set, configuration
                and pipeline. This one keeps its failed result.
              </p>
            </ConfirmButton>
          )}
        </div>
      )}
      {principal !== undefined && (
        <DeploymentRecord
          detail={detail}
          principal={principal}
          pending={action.isPending}
          onRecoveryDecision={(decision) => {
            action.mutate({ kind: "recovery-decision", ...decision });
          }}
        />
      )}
    </>
  );
}

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/deployments/$deploymentId",
  loader: ({ context, params }) =>
    context.queryClient.query({
      ...queries.deployment(params.deploymentId),
      staleTime: "static",
    }),
  component: DeploymentPage,
});
