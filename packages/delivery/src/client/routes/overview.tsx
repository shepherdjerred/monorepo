import { createRoute, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { GridEnvironmentStatusSchema } from "#shared/hub/hub-contract.ts";
import { queries } from "#client/queries.ts";
import {
  ATTENTION_COLLAPSE_AFTER,
  AttentionPanel,
} from "#client/components/attention-panel.tsx";
import { OverviewPanels } from "#client/components/overview-panels.tsx";
import { PageHeader } from "#client/components/page-header.tsx";
import { statusLabel } from "#client/components/status.tsx";
import { FilterProblems } from "./list-page.tsx";
import {
  plainChoices,
  problemsOf,
  resolveChoice,
  unknownFilters,
} from "./catalog-filter.ts";
import { kindPanels } from "./overview-model.ts";
import { PipelineSearchSchema, formSearch } from "./search-schemas.ts";
import { Route as rootRoute } from "./root.tsx";

function OverviewPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data } = useSuspenseQuery(queries.grid());
  const total = data.groups.reduce(
    (sum, group) => sum + group.services.length,
    0,
  );
  const chosen = resolveChoice(
    search.status,
    plainChoices(GridEnvironmentStatusSchema.options),
    "status",
  );
  const problems = problemsOf([
    chosen,
    ...unknownFilters(search, [
      { name: "q", label: "Service" },
      { name: "status", label: "Newest deployment" },
    ]),
  ]);
  const panels =
    problems.length > 0
      ? []
      : kindPanels(data.groups, data.attention, {
          ...search,
          status: chosen.id,
        });
  const shown = panels.reduce((sum, panel) => sum + panel.services.length, 0);
  return (
    <>
      <PageHeader
        eyebrow="Homelab CI/CD"
        title="Overview"
        description="Every active service and where it runs, as Delivery last recorded it. This is the deployment record, not live runtime health."
      />
      <AttentionPanel
        items={data.attention}
        collapseAfter={ATTENTION_COLLAPSE_AFTER}
      />
      <div className="overview-toolbar">
        <form
          className="filters"
          role="search"
          aria-label="Filter services"
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
            Service
            <input type="search" name="q" defaultValue={search.q ?? ""} />
          </label>
          <label>
            Newest deployment
            <select name="status" defaultValue={search.status ?? ""}>
              <option value="">Any status</option>
              {GridEnvironmentStatusSchema.options.map((status) => (
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
        <p className="overview-total">
          {shown === total && problems.length === 0
            ? `${String(total)} services`
            : `${String(shown)} of ${String(total)} services`}
        </p>
      </div>
      {problems.length > 0 ? (
        <FilterProblems problems={problems} clearTo="/" />
      ) : panels.length === 0 ? (
        <p className="empty">
          {total === 0
            ? "No active service is registered with Delivery yet."
            : "No services match these filters."}
        </p>
      ) : (
        <OverviewPanels panels={panels} />
      )}
    </>
  );
}

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: PipelineSearchSchema,
  loader: ({ context }) =>
    context.queryClient.query({ ...queries.grid(), staleTime: "static" }),
  component: OverviewPage,
});
