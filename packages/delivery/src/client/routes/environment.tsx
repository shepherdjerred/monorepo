import { Link, createRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import type { EnvironmentPageDetail } from "#shared/hub/hub-contract.ts";
import { queries } from "#client/queries.ts";
import { PageHeader } from "#client/components/page-header.tsx";
import { ToolLinks } from "#client/components/links.tsx";
import { useNow } from "#client/components/time.tsx";
import { RuntimePanel } from "#client/components/integrations.tsx";
import { DeploymentTable } from "#client/components/deployment-table.tsx";
import { EnvironmentState } from "#client/components/environment-state.tsx";
import { ReleaseForm } from "#client/release-form.tsx";
import { PlatformReleaseForm } from "#client/platform-release-form.tsx";
import { WorkerPoolPanel } from "#client/worker-pool.tsx";
import { ForumBaselinePanel } from "#client/forum-baseline.tsx";
import { EnvironmentModel } from "#client/model/environment-model.tsx";
import {
  SetRevisionLink,
  type RevisionNumbers,
} from "#client/model/selection-facts.tsx";
import {
  environmentBlocker,
  type Blocker,
} from "#client/model/environment-status.ts";
import {
  EnvironmentNotice,
  InFlightSummary,
  usePlanWaiting,
} from "#client/model/environment-notices.tsx";
import { canDeploy, revisionNumbers } from "#client/presentation.ts";
import { EnvironmentSearchSchema } from "./search-schemas.ts";
import { Route as rootRoute } from "./root.tsx";

function policy(detail: {
  approvalPolicy: "none" | "required";
  automatic: boolean;
  promotionSourceEnvironmentId: string | null;
}) {
  if (detail.approvalPolicy === "required") return "Approval required";
  if (detail.automatic) return "Deploys automatically";
  return detail.promotionSourceEnvironmentId === null
    ? "Deploys on request"
    : `Promotes from ${detail.promotionSourceEnvironmentId}`;
}

/** One line under the title: what runs here, under which policy, and what is in flight. */
function Summary({
  detail,
  revisions,
  blocker,
  planWaiting,
}: {
  detail: EnvironmentPageDetail;
  revisions: RevisionNumbers;
  blocker: Blocker | null;
  planWaiting: boolean;
}) {
  const { environment } = detail;
  const accepted = environment.acceptedVersionSetRevisionId;
  return (
    <>
      {accepted === null ? (
        "Nothing accepted yet"
      ) : (
        <>
          Accepted <SetRevisionLink id={accepted} revisions={revisions} />
        </>
      )}
      {" · "}
      {policy(environment)}
      {" · "}generation {environment.generation}
      {" · "}
      <InFlightSummary
        blocker={blocker}
        planWaiting={planWaiting}
        environmentId={environment.id}
        revisions={revisions}
      />
    </>
  );
}

function EnvironmentPage() {
  const { _splat: environmentId = "" } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const now = useNow();
  const { data: detail } = useSuspenseQuery(queries.environment(environmentId));
  const identity = useQuery(queries.identity());
  const overview = useQuery(queries.overview());
  const { environment } = detail;
  const revisions = revisionNumbers(detail);
  const permitted = identity.data !== undefined && canDeploy(identity.data);
  const blocker = environmentBlocker(detail);
  const planWaiting = usePlanWaiting(blocker, detail.pipeline.definition.kind);
  const platform =
    environment.id === "gitops/root" ||
    environment.id.startsWith("gitops/tofu:");
  async function open(deploymentId: string) {
    await navigate({
      to: "/deployments/$deploymentId",
      params: { deploymentId },
    });
  }
  return (
    <>
      <PageHeader
        eyebrow={
          // The overview's name for this environment; the heading keeps its id.
          <>
            <Link
              to="/pipelines/$serviceId"
              params={{ serviceId: detail.service.id }}
            >
              {detail.service.title}
            </Link>
            {" · "}
            {environment.name}
          </>
        }
        title={environment.id}
        description={
          <Summary
            detail={detail}
            revisions={revisions}
            blocker={blocker}
            planWaiting={planWaiting}
          />
        }
        actions={<ToolLinks links={detail.links} />}
      />
      <EnvironmentNotice
        blocker={blocker}
        planWaiting={planWaiting}
        permitted={identity.data === undefined || permitted}
      />
      <div className="detail-grid">
        <EnvironmentState
          environment={environment}
          revisions={revisions}
          now={now}
        />
        <RuntimePanel environmentId={environment.id} />
      </div>
      {platform ? (
        overview.data !== undefined &&
        identity.data !== undefined && (
          <PlatformReleaseForm
            environment={environment}
            overview={overview.data}
            principal={identity.data}
            blocker={blocker}
            planWaiting={planWaiting}
            onDeployment={open}
          />
        )
      ) : (
        <ReleaseForm
          key={environment.id}
          detail={detail}
          permitted={permitted}
          blocker={blocker}
          planWaiting={planWaiting}
          initialKind={search.release}
          {...(search.version === undefined
            ? {}
            : { initialVersion: search.version })}
          onRequested={(deployment) => open(deployment.id)}
        />
      )}
      <EnvironmentModel
        environmentId={environment.id}
        permitted={permitted}
        revisions={revisions}
        blocker={blocker}
        planWaiting={planWaiting}
        onDeployment={open}
      />
      {overview.data !== undefined && (
        <>
          <WorkerPoolPanel
            environment={environment}
            deployments={overview.data.deployments}
            permitted={permitted}
            onDeployment={open}
          />
          <ForumBaselinePanel
            environment={environment}
            intents={overview.data.forumBaselines}
          />
        </>
      )}
      <section className="panel" aria-labelledby="history-heading">
        <div className="section-heading">
          <h2 id="history-heading">Recent deployments</h2>
          <Link to="/deployments" search={{ environment: environment.id }}>
            All deployments
          </Link>
        </div>
        <DeploymentTable
          deployments={detail.deployments}
          empty="No deployments to this environment yet."
          showEnvironment={false}
        />
      </section>
    </>
  );
}

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/environments/$",
  validateSearch: EnvironmentSearchSchema,
  loader: ({ context, params }) =>
    context.queryClient.query({
      ...queries.environment(params._splat ?? ""),
      staleTime: "static",
    }),
  component: EnvironmentPage,
});
