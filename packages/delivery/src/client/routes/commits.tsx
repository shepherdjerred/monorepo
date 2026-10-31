import { Link, createRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import type {
  CommitEnvironment,
  CommitEnvironmentGroup,
  CommitEnvironmentState,
  CommitService,
  CommitStatus,
  CommitSummary,
  CommitVerdict,
} from "#shared/hub/hub-contract.ts";
import { queries } from "#client/queries.ts";
import { PageHeader } from "#client/components/page-header.tsx";
import { RelativeTime } from "#client/components/time.tsx";
import { ShortSha } from "#client/components/links.tsx";
import { SourcePanel } from "#client/components/integrations.tsx";
import { Route as rootRoute } from "./root.tsx";

// Each verdict borrows the color of the pipeline status it resembles, so the
// same green, red and amber mean the same thing everywhere in the hub.
const VERDICT: Record<
  CommitVerdict,
  { status: string; glyph: string; label: string; sentence: string }
> = {
  deployed: {
    status: "succeeded",
    glyph: "✓",
    label: "Deployed",
    sentence: "Live in every environment that tracks it.",
  },
  deploying: {
    status: "running",
    glyph: "◐",
    label: "Deploying",
    sentence: "On its way: some environments do not have it yet.",
  },
  awaiting_approval: {
    status: "awaiting_approval",
    glyph: "⏸",
    label: "Needs approval",
    sentence: "A deployment is waiting for someone to approve it.",
  },
  failed: {
    status: "failed",
    glyph: "✕",
    label: "Deploy failed",
    sentence: "A deployment of this commit failed.",
  },
  build_failed: {
    status: "failed",
    glyph: "✕",
    label: "CI failed",
    sentence: "CI failed, so nothing from this commit was published.",
  },
  building: {
    status: "running",
    glyph: "◐",
    label: "CI running",
    sentence: "CI has not finished, so nothing is deployed yet.",
  },
  waiting: {
    status: "pending",
    glyph: "○",
    label: "Not released",
    sentence:
      "Nothing is in flight: an environment needs a manual release, or its deployment was canceled.",
  },
  nothing_to_deploy: {
    status: "not_started",
    glyph: "–",
    label: "Nothing to deploy",
    sentence: "This commit changed nothing that Delivery deploys.",
  },
  unknown: {
    status: "not_started",
    glyph: "?",
    label: "Not seen yet",
    sentence:
      "Delivery has not heard of this commit. CI may not have published it yet.",
  },
};

const isLiveState = (state: CommitEnvironmentState) =>
  state === "live" || state === "superseded";

const ENVIRONMENT: Record<
  CommitEnvironmentState,
  { status: string; glyph: string; label: string }
> = {
  live: { status: "succeeded", glyph: "✓", label: "live" },
  superseded: { status: "succeeded", glyph: "✓", label: "live (newer)" },
  deploying: { status: "running", glyph: "◐", label: "deploying" },
  awaiting_approval: {
    status: "awaiting_approval",
    glyph: "⏸",
    label: "needs approval",
  },
  failed: { status: "failed", glyph: "✕", label: "failed" },
  canceled: { status: "canceled", glyph: "⊘", label: "canceled" },
  manual: { status: "pending", glyph: "○", label: "needs release" },
  waiting: { status: "pending", glyph: "○", label: "waiting" },
};

function Verdict({ value }: { value: CommitVerdict }) {
  const verdict = VERDICT[value];
  return (
    <span className={`status status-${verdict.status}`}>
      <span className="status-glyph" aria-hidden="true">
        {verdict.glyph}
      </span>
      <span className="status-label">{verdict.label}</span>
    </span>
  );
}

function EnvironmentChip({
  entry,
  label,
}: {
  entry: Pick<CommitEnvironment, "environmentId" | "state" | "deploymentId">;
  label: string;
}) {
  const state = ENVIRONMENT[entry.state];
  const content = (
    <>
      <span className={`status status-${state.status}`}>
        <span className="status-glyph" aria-hidden="true">
          {state.glyph}
        </span>
        <span className="status-label">{state.label}</span>
      </span>
      <span className="env-name">{label}</span>
    </>
  );
  return entry.deploymentId === null ? (
    <Link
      to="/environments/$"
      params={{ _splat: entry.environmentId }}
      className="env-pill"
    >
      {content}
    </Link>
  ) : (
    <Link
      to="/deployments/$deploymentId"
      params={{ deploymentId: entry.deploymentId }}
      className="env-pill"
    >
      {content}
    </Link>
  );
}

function Headline({ buildId }: { buildId: string }) {
  const source = useQuery(queries.source(buildId));
  return source.data?.state === "available" ? (
    <span className="commit-headline">{source.data.data.headline}</span>
  ) : null;
}

// Platform commits touch one environment per stack; the row shows the first few.
const MAX_TALLIES = 4;

function Tally({
  group,
}: {
  group: Pick<
    CommitEnvironmentGroup,
    "name" | "verdict" | "liveCount" | "total"
  >;
}) {
  const verdict = VERDICT[group.verdict];
  return (
    <span className={`status status-${verdict.status} tally`}>
      <span className="status-glyph" aria-hidden="true">
        {verdict.glyph}
      </span>
      <span className="status-label">
        {group.name} {group.liveCount}/{group.total}
      </span>
    </span>
  );
}

function CommitRow({ commit }: { commit: CommitSummary }) {
  const blocker =
    commit.blocker === null
      ? null
      : `${commit.blocker.service}${
          commit.blocker.environment === null
            ? ""
            : ` / ${commit.blocker.environment}`
        }: ${VERDICT[commit.blocker.state].label.toLowerCase()}`;
  return (
    <li className="commit-row">
      <Verdict value={commit.verdict} />
      <Link to="/commits/$sha" params={{ sha: commit.sha }}>
        <ShortSha sha={commit.sha} /> <Headline buildId={commit.buildId} />
      </Link>
      <span className="commit-detail">
        {commit.environments.length > 0 && (
          <span className="tallies">
            {commit.environments.slice(0, MAX_TALLIES).map((group) => (
              <Tally key={group.name} group={group} />
            ))}
            {commit.environments.length > MAX_TALLIES && (
              <span className="muted">
                +{commit.environments.length - MAX_TALLIES} more
              </span>
            )}
          </span>
        )}
        {blocker !== null && <span className="muted">{blocker}</span>}
      </span>
      {commit.seenAt !== null && <RelativeTime value={commit.seenAt} />}
    </li>
  );
}

function CommitsPage() {
  const { data } = useSuspenseQuery(queries.commits());
  const navigate = useNavigate({ from: commitsRoute.fullPath });
  return (
    <>
      <PageHeader
        eyebrow="Homelab CI/CD"
        title="Commits"
        description="Is it deployed? The newest commits, and where each one stands."
      />
      <section className="panel" aria-labelledby="find-heading">
        <h2 id="find-heading">Find a commit</h2>
        <form
          className="filters"
          role="search"
          aria-label="Find a commit"
          onSubmit={(event) => {
            event.preventDefault();
            const sha = new FormData(event.currentTarget).get("sha");
            if (typeof sha === "string" && sha.trim() !== "")
              void navigate({
                to: "/commits/$sha",
                params: { sha: sha.trim() },
              });
          }}
        >
          <label>
            Commit SHA
            <input
              type="search"
              name="sha"
              placeholder="7 or more hex digits"
              pattern="[0-9a-fA-F]{7,40}"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <button type="submit" className="secondary-button">
            Find
          </button>
        </form>
      </section>
      <section className="panel" aria-labelledby="recent-heading">
        <h2 id="recent-heading">Recent commits</h2>
        {data.items.length === 0 ? (
          <p className="empty">Delivery has not seen a commit yet.</p>
        ) : (
          <ul className="commit-list">
            {data.items.map((commit) => (
              <CommitRow key={commit.sha} commit={commit} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function ServiceRow({ entry }: { entry: CommitService }) {
  return (
    <tr>
      <th scope="row" data-label="Service">
        <Link
          to="/pipelines/$serviceId"
          params={{ serviceId: entry.service.id }}
        >
          {entry.service.title}
        </Link>
        {entry.versionSet !== null && (
          <small className="muted">r{entry.versionSet.revision}</small>
        )}
      </th>
      <td data-label="Status">
        <Verdict value={entry.verdict} />
      </td>
      <td data-label="Environments">
        {entry.environments.length === 0 ? (
          <span className="muted">No environment tracks this service</span>
        ) : (
          <ul className="environment-strip">
            {entry.environments.map((environment) => (
              <li key={environment.environmentId}>
                <EnvironmentChip entry={environment} label={environment.name} />
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}

function BuildList({
  title,
  builds,
}: {
  title: string;
  builds: CommitStatus["failedBuilds"];
}) {
  if (builds.length === 0) return null;
  return (
    <section className="panel" aria-label={title}>
      <h2>{title}</h2>
      <ul>
        {builds.map((build) => (
          <li key={build.id}>
            <Link to="/builds/$" params={{ _splat: build.id }}>
              {build.serviceId}
            </Link>
            {build.qualificationReason !== null && (
              <span className="muted"> · {build.qualificationReason}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function EnvironmentGroup({ group }: { group: CommitEnvironmentGroup }) {
  const pending = group.members.filter((member) => !isLiveState(member.state));
  const live = group.members.filter((member) => isLiveState(member.state));
  return (
    <section
      className="panel env-group"
      aria-labelledby={`env-${group.name}-heading`}
    >
      <h3 id={`env-${group.name}-heading`}>
        {group.name} <Verdict value={group.verdict} />{" "}
        <span className="muted">
          {group.liveCount} of {group.total} services live
        </span>
      </h3>
      {pending.length > 0 && (
        <ul className="environment-strip">
          {pending.map((member) => (
            <li key={member.environmentId}>
              <EnvironmentChip entry={member} label={member.serviceTitle} />
            </li>
          ))}
        </ul>
      )}
      {live.length > 0 && (
        <details>
          <summary>{live.length} live</summary>
          <ul className="environment-strip">
            {live.map((member) => (
              <li key={member.environmentId}>
                <EnvironmentChip entry={member} label={member.serviceTitle} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function CommitPage() {
  const { sha } = commitRoute.useParams();
  const { data } = useSuspenseQuery(queries.commit(sha));
  const verdict = VERDICT[data.verdict];
  const live = data.changed.filter(
    (entry) => entry.verdict === "deployed",
  ).length;
  return (
    <>
      <PageHeader
        eyebrow={<Link to="/commits">Commits</Link>}
        title={`Commit ${data.sha.slice(0, 7)}`}
        description={
          <>
            <Verdict value={data.verdict} /> {verdict.sentence}
            {data.changed.length > 0 &&
              ` ${String(live)} of ${String(data.changed.length)} changed services are live.`}
          </>
        }
      />
      {data.buildId !== null && (
        <SourcePanel buildId={data.buildId} sha={data.sha} />
      )}
      <BuildList title="CI failed" builds={data.failedBuilds} />
      <BuildList title="CI still running" builds={data.pendingBuilds} />
      {data.environments.length > 0 && (
        <section aria-labelledby="by-environment-heading">
          <h2 id="by-environment-heading">By environment</h2>
          {data.environments.map((group) => (
            <EnvironmentGroup key={group.name} group={group} />
          ))}
        </section>
      )}
      {data.changed.length > 0 && (
        <section className="panel" aria-labelledby="changed-heading">
          <h2 id="changed-heading">
            By service <span className="muted">({data.changed.length})</span>
          </h2>
          <div className="table-scroll">
            <table className="pipeline-table">
              <thead>
                <tr>
                  <th scope="col">Service</th>
                  <th scope="col">Status</th>
                  <th scope="col">Environments</th>
                </tr>
              </thead>
              <tbody>
                {data.changed.map((entry) => (
                  <ServiceRow key={entry.service.id} entry={entry} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {data.unchangedCount > 0 && (
        <p className="muted">
          {data.unchangedCount} other services built with nothing to deploy.
        </p>
      )}
    </>
  );
}

const commitsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/commits",
  loader: ({ context }) =>
    context.queryClient.query({ ...queries.commits(), staleTime: "static" }),
  component: CommitsPage,
});

const commitRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/commits/$sha",
  loader: ({ context, params }) =>
    context.queryClient.query({
      ...queries.commit(params.sha),
      staleTime: "static",
    }),
  component: CommitPage,
});

export const commitRoutes = [commitsRoute, commitRoute];
