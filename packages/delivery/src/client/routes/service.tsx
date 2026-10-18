import { Link, Outlet, createRoute } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { queries } from "#client/queries.ts";
import { PageHeader } from "#client/components/page-header.tsx";
import { Status } from "#client/components/status.tsx";
import { RelativeTime } from "#client/components/time.tsx";
import { ShortSha, ToolLinks } from "#client/components/links.tsx";
import { PipelineGraph } from "#client/components/pipeline/pipeline-graph.tsx";
import { pipelineStages } from "#client/components/pipeline/pipeline-view-model.ts";
import { CursorSearchSchema } from "./search-schemas.ts";
import { Route as rootRoute } from "./root.tsx";

function ServiceLayout() {
  const { serviceId } = serviceRoute.useParams();
  const { data } = useSuspenseQuery(queries.pipeline(serviceId));
  return (
    <>
      <PageHeader
        eyebrow={<Link to="/">Overview</Link>}
        title={data.service.title}
        description={`Pipeline for ${data.service.id}: source to runtime.`}
        actions={<ToolLinks links={data.service.links} />}
      />
      <nav aria-label="Service views" className="tabs">
        <Link
          to="/services/$serviceId"
          params={{ serviceId }}
          activeOptions={{ exact: true }}
        >
          Pipeline
        </Link>
        <Link to="/services/$serviceId/executions" params={{ serviceId }}>
          Executions
        </Link>
      </nav>
      <Outlet />
    </>
  );
}

const serviceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/services/$serviceId",
  loader: ({ context, params }) =>
    context.queryClient.query({
      ...queries.pipeline(params.serviceId),
      staleTime: "static",
    }),
  component: ServiceLayout,
});

function PipelinePage() {
  const { serviceId } = serviceRoute.useParams();
  const { data } = useSuspenseQuery(queries.pipeline(serviceId));
  const buildId = data.latestBuild?.id;
  const ci = useQuery({
    ...queries.ci(buildId ?? ""),
    enabled: buildId !== undefined,
  });
  const stages = pipelineStages(data.stages, ci.data);
  return (
    <section aria-labelledby="pipeline-heading">
      <h2 id="pipeline-heading" className="visually-hidden">
        Pipeline
      </h2>
      <p className="muted">
        Each stage shows the newest run that reached it. Stages can show
        different revisions while a change moves through.
      </p>
      <PipelineGraph label={`${data.service.title} pipeline`} stages={stages} />
    </section>
  );
}

const pipelineRoute = createRoute({
  getParentRoute: () => serviceRoute,
  path: "/",
  component: PipelinePage,
});

function ExecutionsPage() {
  const { serviceId } = serviceRoute.useParams();
  const { cursor } = executionsRoute.useSearch();
  const { data } = useSuspenseQuery(queries.executions(serviceId, cursor));
  return (
    <section aria-labelledby="executions-heading">
      <h2 id="executions-heading">Executions</h2>
      {data.items.length === 0 ? (
        <p className="empty">No builds or composed version sets yet.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Change</th>
                <th scope="col">Status</th>
                <th scope="col">Version set</th>
                <th scope="col">Environments</th>
                <th scope="col">Started</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((execution) => (
                <tr key={execution.id}>
                  <th scope="row">
                    {execution.build === null ? (
                      execution.versionSet === null ? (
                        execution.id
                      ) : (
                        <Link
                          to="/versions/$versionSetId"
                          params={{ versionSetId: execution.versionSet.id }}
                        >
                          Composed r{execution.versionSet.revision}
                        </Link>
                      )
                    ) : (
                      <Link
                        to="/builds/$"
                        params={{ _splat: execution.build.id }}
                      >
                        <ShortSha sha={execution.build.sourceRevision} />
                        {execution.build.pipelineNumber !== null &&
                          ` · #${String(execution.build.pipelineNumber)}`}
                      </Link>
                    )}
                  </th>
                  <td>
                    <Status value={execution.status} />
                  </td>
                  <td>
                    {execution.versionSet === null
                      ? "—"
                      : `r${String(execution.versionSet.revision)}`}
                  </td>
                  <td>
                    <ul className="inline-list">
                      {execution.deployments.map((deployment) => (
                        <li key={deployment.deploymentId}>
                          <Link
                            to="/deployments/$deploymentId"
                            params={{ deploymentId: deployment.deploymentId }}
                          >
                            <Status value={deployment.status} />{" "}
                            {deployment.environmentId}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td>
                    <RelativeTime value={execution.createdAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <nav aria-label="Pages" className="pager">
        {cursor !== undefined && (
          <Link
            to="/services/$serviceId/executions"
            params={{ serviceId }}
            search={{}}
          >
            Newest
          </Link>
        )}
        {data.nextCursor !== null && (
          <Link
            to="/services/$serviceId/executions"
            params={{ serviceId }}
            search={{ cursor: data.nextCursor }}
          >
            Older
          </Link>
        )}
      </nav>
    </section>
  );
}

const executionsRoute = createRoute({
  getParentRoute: () => serviceRoute,
  path: "/executions",
  validateSearch: CursorSearchSchema,
  loaderDeps: ({ search }) => ({ cursor: search.cursor }),
  loader: ({ context, params, deps }) =>
    context.queryClient.query({
      ...queries.executions(params.serviceId, deps.cursor),
      staleTime: "static",
    }),
  component: ExecutionsPage,
});

export const serviceTree = serviceRoute.addChildren([
  pipelineRoute,
  executionsRoute,
]);
