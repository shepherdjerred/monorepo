import { Link, createRoute, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  PipelineStatusSchema,
  type BuildView,
  type HubService,
  type PipelineStatus,
} from "#shared/hub/hub-contract.ts";
import { queries } from "#client/queries.ts";
import { AttentionPanel } from "#client/components/attention-panel.tsx";
import { PageHeader } from "#client/components/page-header.tsx";
import { Status, statusLabel } from "#client/components/status.tsx";
import { RelativeTime } from "#client/components/time.tsx";
import { ShortSha, ToolLinks } from "#client/components/links.tsx";
import {
  ciStatus,
  filterPipelines,
  lastDeployment,
} from "./pipeline-list-model.ts";
import {
  plainChoices,
  problemsOf,
  resolveChoice,
  unknownFilters,
} from "./catalog-filter.ts";
import { FilterProblems } from "./list-page.tsx";
import { PipelineSearchSchema, formSearch } from "./search-schemas.ts";
import { Route as rootRoute } from "./root.tsx";

/**
 * The service's newest CI run: its own result and its Woodpecker pipeline
 * number, which every service built by that run shares. It says nothing
 * about the environments; the stages column does.
 */
function CiRunCell({ build }: { build: BuildView | null }) {
  if (build === null) return <span className="muted">No CI run</span>;
  return (
    <span className="execution-cell">
      <Status value={ciStatus(build)} />
      <Link to="/builds/$" params={{ _splat: build.id }}>
        {build.pipelineNumber === null
          ? "View build"
          : `CI run #${String(build.pipelineNumber)}`}
      </Link>
    </span>
  );
}

function SourceCell({ build }: { build: BuildView | null }) {
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

/** Stage states a glyph says alone; every other one is spelled out. */
const SETTLED: ReadonlySet<PipelineStatus> = new Set([
  "succeeded",
  "not_started",
]);

/**
 * Each stage's current state: the newest CI run's build, then each
 * environment's newest deployment, where a failure that locked the
 * environment reads "recovery required".
 */
function StageStrip({ pipeline }: { pipeline: HubService }) {
  const build = pipeline.latestBuild;
  return (
    <ol className="environment-strip" aria-label={`${pipeline.title} stages`}>
      {build !== null && (
        <li>
          <Link
            to="/builds/$"
            params={{ _splat: build.id }}
            className="env-pill"
          >
            <Status value={ciStatus(build)} />
            <span className="env-name">Build</span>
          </Link>
        </li>
      )}
      {pipeline.environments.map((env) => (
        <li key={env.id}>
          <Link
            to="/environments/$"
            params={{ _splat: env.id }}
            className={
              SETTLED.has(env.status) && !env.recoveryRequired
                ? "env-pill"
                : "env-pill env-pill-spelled"
            }
          >
            {env.recoveryRequired ? (
              <Status value="failed" label="recovery required" />
            ) : (
              <Status value={env.status} />
            )}
            <span className="env-name">{env.name}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

/**
 * When the pipeline last built and last deployed, each named: a build and a
 * deployment are different events, and a deployment of an older build is
 * still the newest thing that happened to the pipeline.
 */
function LastActivity({ pipeline }: { pipeline: HubService }) {
  const deployed = lastDeployment(pipeline);
  const build = pipeline.latestBuild;
  return (
    <span className="last-activity">
      <span>
        Last build{" "}
        {build === null ? (
          <span className="muted">never</span>
        ) : (
          <RelativeTime value={build.createdAt} />
        )}
      </span>
      <span>
        Last deployment{" "}
        {deployed === null ? (
          <span className="muted">never</span>
        ) : (
          <RelativeTime value={deployed} />
        )}
      </span>
    </span>
  );
}

function PipelineRow({ pipeline }: { pipeline: HubService }) {
  return (
    <tr>
      <th scope="row" data-label="Name">
        <Link to="/pipelines/$serviceId" params={{ serviceId: pipeline.id }}>
          {pipeline.title}
        </Link>
        <small className="muted">{pipeline.id}</small>
      </th>
      <td data-label="Latest CI run">
        <CiRunCell build={pipeline.latestBuild} />
      </td>
      <td data-label="Source revision">
        <SourceCell build={pipeline.latestBuild} />
      </td>
      <td data-label="Stages">
        <StageStrip pipeline={pipeline} />
      </td>
      <td data-label="Last activity">
        <LastActivity pipeline={pipeline} />
      </td>
    </tr>
  );
}

function PipelinesPage() {
  const search = pipelinesRoute.useSearch();
  const navigate = useNavigate({ from: pipelinesRoute.fullPath });
  const { data } = useSuspenseQuery(queries.hub());
  const chosen = resolveChoice(
    search.status,
    plainChoices(PipelineStatusSchema.options),
    "status",
  );
  const problems = problemsOf([
    chosen,
    ...unknownFilters(search, [
      { name: "q", label: "Name" },
      { name: "status", label: "Stage status" },
    ]),
  ]);
  const pipelines =
    problems.length > 0
      ? []
      : filterPipelines(data.services, { ...search, status: chosen.id });
  return (
    <>
      <PageHeader
        eyebrow="Homelab CI/CD"
        title="Pipelines"
        description="Every pipeline from commit to runtime: its newest CI run, and where each environment stands."
        actions={<ToolLinks links={data.tools} />}
      />
      {/* What needs someone leads, as on the overview. */}
      <AttentionPanel items={data.attention} collapseAfter={5} />
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
          data-search-form
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
            Stage status
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
        {problems.length > 0 ? (
          <FilterProblems problems={problems} clearTo="/pipelines" />
        ) : pipelines.length === 0 ? (
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
                  <th scope="col">Latest CI run</th>
                  <th scope="col">Source revision</th>
                  <th scope="col">Stages</th>
                  <th scope="col">Last activity</th>
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

export const pipelineListRoutes = [pipelinesRoute];
