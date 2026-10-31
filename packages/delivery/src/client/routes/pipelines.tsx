import {
  Link,
  Navigate,
  createRoute,
  useNavigate,
} from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  PipelineStatusSchema,
  type Attention,
  type ExecutionSummary,
  type HubService,
} from "#shared/hub/hub-contract.ts";
import { queries } from "#client/queries.ts";
import { PageHeader } from "#client/components/page-header.tsx";
import { Status, statusLabel } from "#client/components/status.tsx";
import { RelativeTime } from "#client/components/time.tsx";
import { ShortSha, TargetLink, ToolLinks } from "#client/components/links.tsx";
import { filterPipelines, lastExecuted } from "./pipeline-list-model.ts";
import { PipelineSearchSchema, formSearch } from "./search-schemas.ts";
import { Route as rootRoute } from "./root.tsx";

const ATTENTION: Record<Attention["kind"], string> = {
  approval: "Approval",
  failed: "Failed",
  recovery: "Recovery",
  build_failed: "Build",
};

function AttentionPanel({ items }: { items: Attention[] }) {
  if (items.length === 0) return null;
  return (
    <section className="panel attention" aria-labelledby="attention-heading">
      <h2 id="attention-heading">Needs attention</h2>
      <ul>
        {items.map((item) => (
          <li key={`${item.kind}:${item.target.id}`}>
            <span className={`badge badge-${item.kind}`}>
              {ATTENTION[item.kind]}
            </span>
            <TargetLink target={item.target}>{item.title}</TargetLink>
            <span className="muted">{item.detail}</span>
            {item.at !== null && <RelativeTime value={item.at} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ExecutionCell({ execution }: { execution: ExecutionSummary | null }) {
  if (execution === null) return <Status value="not_started" />;
  const { build, versionSet } = execution;
  return (
    <span className="execution-cell">
      <Status value={execution.status} />
      {build !== null && (
        <Link to="/builds/$" params={{ _splat: build.id }}>
          {build.pipelineNumber === null
            ? "View execution"
            : `Execution #${String(build.pipelineNumber)}`}
        </Link>
      )}
      {build === null && versionSet !== null && (
        <Link
          to="/versions/$versionSetId"
          params={{ versionSetId: versionSet.id }}
        >
          Composed r{versionSet.revision}
        </Link>
      )}
    </span>
  );
}

function SourceCell({ execution }: { execution: ExecutionSummary | null }) {
  const build = execution?.build ?? null;
  if (build === null) return <span className="muted">—</span>;
  const commit = build.links.find((link) => link.kind === "github");
  return commit === undefined ? (
    <ShortSha sha={build.sourceRevision} />
  ) : (
    <a href={commit.url}>
      <ShortSha sha={build.sourceRevision} />
      <span aria-hidden="true"> ↗</span>
    </a>
  );
}

function StageStrip({ pipeline }: { pipeline: HubService }) {
  const build = pipeline.latestExecution?.build ?? null;
  return (
    <ol className="environment-strip" aria-label={`${pipeline.title} stages`}>
      {build !== null && (
        <li>
          <Link
            to="/builds/$"
            params={{ _splat: build.id }}
            className="env-pill"
          >
            <Status value={build.status} />
            <span className="env-name">Build</span>
          </Link>
        </li>
      )}
      {pipeline.environments.map((env) => (
        <li key={env.id}>
          <Link
            to="/environments/$"
            params={{ _splat: env.id }}
            className="env-pill"
          >
            <Status value={env.status} />
            <span className="env-name">{env.name}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

function PipelineRow({ pipeline }: { pipeline: HubService }) {
  const execution = pipeline.latestExecution;
  return (
    <tr>
      <th scope="row" data-label="Name">
        <Link to="/pipelines/$serviceId" params={{ serviceId: pipeline.id }}>
          {pipeline.title}
        </Link>
        <small className="muted">{pipeline.id}</small>
      </th>
      <td data-label="Most recent execution">
        <ExecutionCell execution={execution} />
      </td>
      <td data-label="Source revision">
        <SourceCell execution={execution} />
      </td>
      <td data-label="Stages">
        <StageStrip pipeline={pipeline} />
      </td>
      <td data-label="Last executed">
        {execution === null ? (
          <span className="muted">Never</span>
        ) : (
          <RelativeTime value={lastExecuted(execution)} />
        )}
      </td>
    </tr>
  );
}

function PipelinesPage() {
  const search = pipelinesRoute.useSearch();
  const navigate = useNavigate({ from: pipelinesRoute.fullPath });
  const { data } = useSuspenseQuery(queries.hub());
  const pipelines = filterPipelines(data.services, search);
  return (
    <>
      <PageHeader
        eyebrow="Homelab CI/CD"
        title="Pipelines"
        description="Every pipeline from commit to runtime, with its most recent execution."
        actions={<ToolLinks links={data.tools} />}
      />
      <section className="panel" aria-labelledby="pipelines-heading">
        <div className="section-heading">
          <h2 id="pipelines-heading">
            Pipelines{" "}
            <span className="muted">
              ({pipelines.length}
              {pipelines.length === data.services.length
                ? ""
                : ` of ${String(data.services.length)}`}
              )
            </span>
          </h2>
        </div>
        <form
          className="filters"
          role="search"
          aria-label="Filter pipelines"
          onSubmit={(event) => {
            event.preventDefault();
            void navigate({
              search: PipelineSearchSchema.parse(
                formSearch(event.currentTarget),
              ),
            });
          }}
        >
          <label>
            Name
            <input type="search" name="q" defaultValue={search.q ?? ""} />
          </label>
          <label>
            Most recent execution
            <select name="status" defaultValue={search.status ?? ""}>
              <option value="">Any status</option>
              {PipelineStatusSchema.options.map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status)}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="secondary-button">
            Filter
          </button>
        </form>
        {pipelines.length === 0 ? (
          <p className="empty">
            {data.services.length === 0
              ? "No services publish through Delivery yet."
              : "No pipelines match these filters."}
          </p>
        ) : (
          <div className="table-scroll">
            <table className="pipeline-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Most recent execution</th>
                  <th scope="col">Source revision</th>
                  <th scope="col">Stages</th>
                  <th scope="col">Last executed</th>
                </tr>
              </thead>
              <tbody>
                {pipelines.map((pipeline) => (
                  <PipelineRow key={pipeline.id} pipeline={pipeline} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <AttentionPanel items={data.attention} />
    </>
  );
}

const pipelinesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pipelines",
  validateSearch: PipelineSearchSchema,
  loader: ({ context }) =>
    context.queryClient.query({ ...queries.hub(), staleTime: "static" }),
  component: PipelinesPage,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <Navigate to="/commits" replace />,
});

export const pipelineListRoutes = [indexRoute, pipelinesRoute];
