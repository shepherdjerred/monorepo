import { Link, createRoute, useNavigate } from "@tanstack/react-router";
import {
  useQuery,
  useSuspenseQuery,
  type QueryClient,
} from "@tanstack/react-query";
import { queries } from "#client/queries.ts";
import {
  PageHeader,
  SECTION_EYEBROW,
} from "#client/components/page-header.tsx";
import { DeploymentTable } from "#client/components/deployment-table.tsx";
import { catalogNames } from "#client/components/catalog-name.tsx";
import { OlderLink } from "#client/components/pager.tsx";
import { BuildTable } from "#client/artifacts.tsx";
import { ApprovalQueue } from "#client/model/approval-queue.tsx";
import { useNow, zoneLabel } from "#client/components/time.tsx";
import { ActivityList, ActivityScope } from "./activity-list.tsx";
import { foldActivity } from "./activity-fold.ts";
import { catalogServices } from "./catalog-filter.ts";
import {
  ACTION_MAX,
  ACTOR_MAX,
  ENTITY_MAX,
  QUALIFICATIONS,
  STATUSES,
  activityFilters,
  artifactFilters,
  deploymentFilters,
  type Search,
} from "./list-filters.ts";
import {
  CatalogOptions,
  ENVIRONMENT_OPTIONS,
  FilterForm,
  ListPanel,
  ResultSummary,
  resolvedPage,
  submitted,
  SERVICE_OPTIONS,
  isFiltered,
} from "./list-page.tsx";
import {
  ActivitySearchSchema,
  ArtifactSearchSchema,
  DeploymentSearchSchema,
  formSearch,
} from "./search-schemas.ts";
import { Route as rootRoute, RouteError } from "./root.tsx";

/**
 * The catalog a service or environment filter resolves against. Without it a
 * filter still works by exact id, so a failed read never blocks the list.
 */
async function loadCatalog(queryClient: QueryClient, search: Search) {
  if (search["service"] === undefined && search["environment"] === undefined)
    return [];
  try {
    return catalogServices(
      await queryClient.query({ ...queries.grid(), staleTime: "static" }),
    );
  } catch {
    return [];
  }
}

function useCatalog() {
  return catalogServices(useQuery(queries.grid()).data);
}

/** A failed read of a list keeps the page and offers to start again. */
function listError(to: "/deployments" | "/artifacts" | "/activity") {
  return function ListError({ error }: { error: Error }) {
    return (
      <RouteError
        error={error}
        recovery={
          <Link to={to} search={{}}>
            Clear filters and paging
          </Link>
        }
      />
    );
  };
}

function DeploymentsPage() {
  const search = deploymentsRoute.useSearch();
  const navigate = useNavigate({ from: deploymentsRoute.fullPath });
  const services = useCatalog();
  const filters = deploymentFilters(search, services);
  const { data } = useQuery({
    ...queries.deployments(filters.query),
    enabled: filters.problems.length === 0,
  });
  const shown = resolvedPage(data, filters.problems);
  const items = shown?.items ?? [];
  return (
    <>
      <PageHeader
        eyebrow={SECTION_EYEBROW}
        title="Deployments"
        description="Every deployment request, newest first."
      />
      <ListPanel heading="Deployment history">
        <FilterForm
          label="Filter deployments"
          onSearch={(form) => {
            void navigate({
              search: DeploymentSearchSchema.parse(
                submitted(form, (values) =>
                  deploymentFilters(values, services),
                ),
              ),
            });
          }}
        >
          <CatalogOptions services={services} environments />
          <label>
            Service
            <input
              name="service"
              list={SERVICE_OPTIONS}
              autoComplete="off"
              defaultValue={search.service ?? ""}
            />
          </label>
          <label>
            Environment
            <input
              name="environment"
              list={ENVIRONMENT_OPTIONS}
              autoComplete="off"
              defaultValue={search.environment ?? ""}
            />
          </label>
          <label>
            Status
            <select name="status" defaultValue={search.status ?? ""}>
              <option value="">Any status</option>
              {STATUSES.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </label>
        </FilterForm>
        <ResultSummary
          count={items.length}
          noun={["deployment", "deployments"]}
          filtered={isFiltered(search)}
          older={search.cursor !== undefined}
          more={shown?.nextCursor != null}
          problems={filters.problems}
          clearTo="/deployments"
        />
        {items.length > 0 && (
          <DeploymentTable
            deployments={items}
            empty="No deployments match these filters."
            names={catalogNames(services)}
          />
        )}
        <OlderLink
          to="/deployments"
          search={search}
          cursor={shown?.nextCursor ?? null}
        />
      </ListPanel>
    </>
  );
}

const deploymentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/deployments",
  validateSearch: DeploymentSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    const filters = deploymentFilters(
      deps,
      await loadCatalog(context.queryClient, deps),
    );
    if (filters.problems.length === 0)
      await context.queryClient.query({
        ...queries.deployments(filters.query),
        staleTime: "static",
      });
  },
  component: DeploymentsPage,
  errorComponent: listError("/deployments"),
});

function ApprovalsPage() {
  const { data } = useSuspenseQuery(queries.approvals());
  const services = useCatalog();
  // The waiting deployments' list rows carry their set revision's number.
  const waiting = useQuery(
    queries.deployments({ status: "awaiting_approval" }),
  ).data;
  return (
    <>
      <PageHeader
        eyebrow={SECTION_EYEBROW}
        title="Approvals"
        description="Review the exact selection before it reaches production."
      />
      <ApprovalQueue
        items={data}
        services={services}
        revisions={waiting?.items ?? []}
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
  const services = useCatalog();
  const filters = artifactFilters(search, services);
  const { data } = useQuery({
    ...queries.builds(filters.query),
    enabled: filters.problems.length === 0,
  });
  const shown = resolvedPage(data, filters.problems);
  const items = shown?.items ?? [];
  return (
    <>
      <PageHeader
        eyebrow={SECTION_EYEBROW}
        title="Artifacts"
        description="Builds, their qualification, and the immutable artifacts they published."
      />
      <ListPanel
        heading="Build qualification"
        aside={
          <span className="muted">
            CI verification determines release eligibility
          </span>
        }
      >
        <FilterForm
          label="Filter builds"
          onSearch={(form) => {
            void navigate({
              search: ArtifactSearchSchema.parse(
                submitted(form, (values) => artifactFilters(values, services)),
              ),
            });
          }}
        >
          <CatalogOptions services={services} />
          <label>
            Service
            <input
              name="service"
              list={SERVICE_OPTIONS}
              autoComplete="off"
              defaultValue={search.service ?? ""}
            />
          </label>
          <label>
            Qualification
            <select name="status" defaultValue={search.status ?? ""}>
              <option value="">Any</option>
              {QUALIFICATIONS.map((qualification) => (
                <option key={qualification.value} value={qualification.value}>
                  {qualification.label}
                </option>
              ))}
            </select>
          </label>
        </FilterForm>
        <ResultSummary
          count={items.length}
          noun={["build", "builds"]}
          filtered={isFiltered(search)}
          older={search.cursor !== undefined}
          more={shown?.nextCursor != null}
          problems={filters.problems}
          clearTo="/artifacts"
        />
        {items.length > 0 && (
          <BuildTable builds={items} names={catalogNames(services)} />
        )}
        <OlderLink
          to="/artifacts"
          search={search}
          cursor={shown?.nextCursor ?? null}
        />
      </ListPanel>
    </>
  );
}

const artifactsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/artifacts",
  validateSearch: ArtifactSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    const filters = artifactFilters(
      deps,
      await loadCatalog(context.queryClient, deps),
    );
    if (filters.problems.length === 0)
      await context.queryClient.query({
        ...queries.builds(filters.query),
        staleTime: "static",
      });
  },
  component: ArtifactsPage,
  errorComponent: listError("/artifacts"),
});

function ActivityPage() {
  const search = activityRoute.useSearch();
  const navigate = useNavigate({ from: activityRoute.fullPath });
  const filters = activityFilters(search);
  const services = useCatalog();
  const { data } = useQuery({
    ...queries.activity(filters.query),
    enabled: filters.problems.length === 0,
  });
  const shown = resolvedPage(data, filters.problems);
  const items = shown?.items ?? [];
  // A row can fold several events, so the count says rows and events both.
  const rows = foldActivity(items).length;
  const now = useNow();
  return (
    <>
      <PageHeader
        eyebrow={SECTION_EYEBROW}
        title="Activity"
        description={`The audit trail of every Delivery decision and result. Times are ${zoneLabel(now)}.`}
      />
      <ListPanel heading="Audit trail">
        <FilterForm
          label="Filter activity"
          onSearch={(form) => {
            void navigate({
              search: ActivitySearchSchema.parse(formSearch(form)),
            });
          }}
        >
          <ActivityScope search={search} />
          <label>
            Action prefix
            <input
              name="action"
              maxLength={ACTION_MAX}
              defaultValue={search.action ?? ""}
              placeholder="deployment."
            />
          </label>
          <label>
            Actor
            <input
              name="actor"
              maxLength={ACTOR_MAX}
              defaultValue={search.actor ?? ""}
            />
          </label>
          <label>
            Entity
            <input
              name="entity"
              maxLength={ENTITY_MAX}
              defaultValue={search.entity ?? ""}
            />
          </label>
        </FilterForm>
        <ResultSummary
          count={rows}
          noun={rows === items.length ? ["event", "events"] : ["row", "rows"]}
          entries={{
            count: items.length,
            noun: ["event", "events"],
            folded: "steps and repeats folded",
          }}
          filtered={isFiltered(search)}
          older={search.cursor !== undefined}
          more={shown?.nextCursor != null}
          problems={filters.problems}
          clearTo="/activity"
        />
        {items.length > 0 && (
          <ActivityList entries={items} services={services} />
        )}
        <OlderLink
          to="/activity"
          search={search}
          cursor={shown?.nextCursor ?? null}
        />
      </ListPanel>
    </>
  );
}

const activityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/activity",
  validateSearch: ActivitySearchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    const filters = activityFilters(deps);
    if (filters.problems.length === 0)
      await context.queryClient.query({
        ...queries.activity(filters.query),
        staleTime: "static",
      });
  },
  component: ActivityPage,
  errorComponent: listError("/activity"),
});

export const listRoutes = [
  deploymentsRoute,
  approvalsRoute,
  artifactsRoute,
  activityRoute,
];
