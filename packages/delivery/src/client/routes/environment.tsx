import { Link, createRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
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
import { canDeploy } from "#client/presentation.ts";
import { EnvironmentSearchSchema } from "./search-schemas.ts";
import { Route as rootRoute } from "./root.tsx";

function policy(detail: {
  approvalRequired: boolean;
  automatic: boolean;
  promotionSourceEnvironmentId: string | null;
}) {
  if (detail.approvalRequired) return "Approval required";
  if (detail.automatic) return "Deploys automatically";
  return detail.promotionSourceEnvironmentId === null
    ? "Deploys on request"
    : `Promotes from ${detail.promotionSourceEnvironmentId}`;
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
  const permitted = identity.data !== undefined && canDeploy(identity.data);
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
          <Link
            to="/services/$serviceId"
            params={{ serviceId: detail.service.id }}
          >
            {detail.service.title}
          </Link>
        }
        title={environment.id}
        description={`${policy(environment)} · generation ${String(environment.generation)}`}
        actions={<ToolLinks links={detail.links} />}
      />
      <div className="detail-grid">
        <EnvironmentState
          environment={environment}
          versions={detail.versionSets}
          now={now}
        />
        <RuntimePanel environmentId={environment.id} />
      </div>
      {environment.activeDeploymentId !== null && (
        <p className="notice">
          Active deployment{" "}
          <Link
            to="/deployments/$deploymentId"
            params={{ deploymentId: environment.activeDeploymentId }}
          >
            {environment.activeDeploymentId}
          </Link>
        </p>
      )}
      {platform ? (
        overview.data !== undefined &&
        identity.data !== undefined && (
          <PlatformReleaseForm
            environment={environment}
            overview={overview.data}
            principal={identity.data}
            onDeployment={open}
          />
        )
      ) : (
        <ReleaseForm
          key={environment.id}
          detail={detail}
          permitted={permitted}
          initialKind={search.release}
          {...(search.version === undefined
            ? {}
            : { initialVersion: search.version })}
          onRequested={(deployment) => open(deployment.id)}
        />
      )}
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
