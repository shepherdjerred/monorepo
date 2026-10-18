import { Link, createRoute, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { queries } from "#client/queries.ts";
import { PageHeader } from "#client/components/page-header.tsx";
import { DeploymentTable } from "#client/components/deployment-table.tsx";
import { BuildCatalog } from "#client/artifacts.tsx";
import { ActivityList } from "./activity-list.tsx";
import {
  ActivitySearchSchema,
  ArtifactSearchSchema,
  DeploymentSearchSchema,
  formSearch,
} from "./search-schemas.ts";
import { Route as rootRoute } from "./root.tsx";

const STATUSES = [
  "awaiting_approval",
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
] as const;

function OlderLink({
  to,
  search,
  cursor,
}: {
  to: "/deployments" | "/artifacts" | "/activity";
  search: Record<string, string | undefined>;
  cursor: string | null;
}) {
  return (
    <nav aria-label="Pages" className="pager">
      {search["cursor"] !== undefined && (
        <Link to={to} search={{ ...search, cursor: undefined }}>
          Newest
        </Link>
      )}
      {cursor !== null && (
        <Link to={to} search={{ ...search, cursor }}>
          Older
        </Link>
      )}
    </nav>
  );
}

function DeploymentsPage() {
  const search = deploymentsRoute.useSearch();
  const navigate = useNavigate({ from: deploymentsRoute.fullPath });
  const { data } = useSuspenseQuery(
    queries.deployments({
      cursor: search.cursor,
      serviceId: search.service,
      environmentId: search.environment,
      status: search.status,
    }),
  );
  return (
    <>
      <PageHeader
        title="Deployments"
        description="Every deployment request, newest first."
      />
      <form
        className="filters"
        role="search"
        aria-label="Filter deployments"
        onSubmit={(event) => {
          event.preventDefault();
          void navigate({
            search: DeploymentSearchSchema.parse(
              formSearch(event.currentTarget),
            ),
          });
        }}
      >
        <label>
          Service
          <input name="service" defaultValue={search.service ?? ""} />
        </label>
        <label>
          Environment
          <input name="environment" defaultValue={search.environment ?? ""} />
        </label>
        <label>
          Status
          <select name="status" defaultValue={search.status ?? ""}>
            <option value="">Any status</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="secondary-button">
          Filter
        </button>
      </form>
      <DeploymentTable
        deployments={data.items}
        empty="No deployments match these filters."
      />
      <OlderLink to="/deployments" search={search} cursor={data.nextCursor} />
    </>
  );
}

const deploymentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/deployments",
  validateSearch: DeploymentSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.queryClient.query({
      ...queries.deployments({
        cursor: deps.cursor,
        serviceId: deps.service,
        environmentId: deps.environment,
        status: deps.status,
      }),
      staleTime: "static",
    }),
  component: DeploymentsPage,
});

function ApprovalsPage() {
  const { data } = useSuspenseQuery(queries.approvals());
  return (
    <>
      <PageHeader
        title="Approvals"
        description="Review the exact release before it reaches production."
      />
      <DeploymentTable
        deployments={data}
        empty="Nothing is waiting for approval."
      />
    </>
  );
}

const approvalsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/approvals",
  loader: ({ context }) =>
    context.queryClient.query({ ...queries.approvals(), staleTime: "static" }),
  component: ApprovalsPage,
});

function ArtifactsPage() {
  const search = artifactsRoute.useSearch();
  const navigate = useNavigate({ from: artifactsRoute.fullPath });
  const { data } = useSuspenseQuery(
    queries.builds({
      cursor: search.cursor,
      serviceId: search.service,
      status: search.status,
    }),
  );
  return (
    <>
      <PageHeader
        title="Artifacts"
        description="Builds, their qualification, and the immutable artifacts they published."
      />
      <form
        className="filters"
        role="search"
        aria-label="Filter builds"
        onSubmit={(event) => {
          event.preventDefault();
          void navigate({
            search: ArtifactSearchSchema.parse(formSearch(event.currentTarget)),
          });
        }}
      >
        <label>
          Service
          <input name="service" defaultValue={search.service ?? ""} />
        </label>
        <label>
          Qualification
          <select name="status" defaultValue={search.status ?? ""}>
            <option value="">Any</option>
            <option value="verified">verified</option>
            <option value="pending">pending</option>
            <option value="failed">failed</option>
          </select>
        </label>
        <button type="submit" className="secondary-button">
          Filter
        </button>
      </form>
      <BuildCatalog builds={data.items} />
      <OlderLink to="/artifacts" search={search} cursor={data.nextCursor} />
    </>
  );
}

const artifactsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/artifacts",
  validateSearch: ArtifactSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.queryClient.query({
      ...queries.builds({
        cursor: deps.cursor,
        serviceId: deps.service,
        status: deps.status,
      }),
      staleTime: "static",
    }),
  component: ArtifactsPage,
});

function ActivityPage() {
  const search = activityRoute.useSearch();
  const navigate = useNavigate({ from: activityRoute.fullPath });
  const { data } = useSuspenseQuery(
    queries.activity({
      cursor: search.cursor,
      actor: search.actor,
      action: search.action,
      entityId: search.entity,
    }),
  );
  return (
    <>
      <PageHeader
        title="Activity"
        description="The audit trail of every Delivery decision and result."
      />
      <form
        className="filters"
        role="search"
        aria-label="Filter activity"
        onSubmit={(event) => {
          event.preventDefault();
          void navigate({
            search: ActivitySearchSchema.parse(formSearch(event.currentTarget)),
          });
        }}
      >
        <label>
          Action prefix
          <input
            name="action"
            defaultValue={search.action ?? ""}
            placeholder="deployment."
          />
        </label>
        <label>
          Actor
          <input name="actor" defaultValue={search.actor ?? ""} />
        </label>
        <label>
          Entity
          <input name="entity" defaultValue={search.entity ?? ""} />
        </label>
        <button type="submit" className="secondary-button">
          Filter
        </button>
      </form>
      <ActivityList entries={data.items} />
      <OlderLink to="/activity" search={search} cursor={data.nextCursor} />
    </>
  );
}

const activityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/activity",
  validateSearch: ActivitySearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.queryClient.query({
      ...queries.activity({
        cursor: deps.cursor,
        actor: deps.actor,
        action: deps.action,
        entityId: deps.entity,
      }),
      staleTime: "static",
    }),
  component: ActivityPage,
});

export const listRoutes = [
  deploymentsRoute,
  approvalsRoute,
  artifactsRoute,
  activityRoute,
];
