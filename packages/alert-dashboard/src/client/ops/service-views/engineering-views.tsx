import { Loaded } from "@shepherdjerred/loaded";
import type {
  TrackerNotice,
  TrackerProjectSummary,
  TrackerUrgentIssue,
} from "@shepherdjerred/ops-model/facets.ts";
import { useQuery } from "@tanstack/react-query";
import { ExternalLinkIcon } from "lucide-react";

import {
  CiServiceView,
  DeliveryServiceView,
  GitOpsServiceView,
} from "./engineering-scm-views.tsx";
import { SeriesChart } from "#client/charts/series-chart.tsx";
import { facetQuery } from "#client/ops/ops-api.ts";
import { StaleNotice } from "#client/stale-notice.tsx";
import { age } from "#client/time.ts";
import { DataTable, type DataTableColumn } from "#client/visuals/index.ts";
import type { SeriesRange } from "#shared/ops-schema";
import "#styles/engineering.css";

const TRACKER_NOTICE_COLUMNS: readonly DataTableColumn<TrackerNotice>[] = [
  {
    key: "identifier",
    header: "Notice",
    sortValue: (row) => row.identifier,
    render: (row) => (
      <a
        className="eng-ext-link"
        href={row.url}
        target="_blank"
        rel="noreferrer"
      >
        {row.identifier}
        <ExternalLinkIcon aria-hidden="true" />
      </a>
    ),
  },
  {
    key: "kind",
    header: "Kind",
    sortValue: (row) => row.kind,
    render: (row) => (
      <span className="visual-pill" data-sev="info">
        {row.kind}
      </span>
    ),
  },
  {
    key: "title",
    header: "Title",
    sortValue: (row) => row.title,
    render: (row) => row.title,
  },
  {
    key: "owner",
    header: "Owner",
    sortValue: (row) => row.owner,
    render: (row) => row.owner ?? "—",
  },
  {
    key: "updatedAt",
    header: "Updated",
    align: "right",
    sortValue: (row) => row.updatedAt,
    render: (row) => <time dateTime={row.updatedAt}>{age(row.updatedAt)}</time>,
  },
];

const TRACKER_PROJECT_COLUMNS: readonly DataTableColumn<TrackerProjectSummary>[] =
  [
    {
      key: "name",
      header: "Project",
      sortValue: (row) => row.name,
      render: (row) => row.name,
    },
    {
      key: "team",
      header: "Team",
      sortValue: (row) => row.team,
      render: (row) => <span className="visual-pill">{row.team}</span>,
    },
    {
      key: "openCount",
      header: "Open",
      align: "right",
      sortValue: (row) => row.openCount,
      render: (row) => String(row.openCount),
    },
    {
      key: "completed7dCount",
      header: "Completed (7d)",
      align: "right",
      sortValue: (row) => row.completed7dCount,
      render: (row) => String(row.completed7dCount),
    },
  ];

const TRACKER_URGENT_COLUMNS: readonly DataTableColumn<TrackerUrgentIssue>[] = [
  {
    key: "identifier",
    header: "Issue",
    sortValue: (row) => row.identifier,
    render: (row) => (
      <a
        className="eng-ext-link"
        href={row.url}
        target="_blank"
        rel="noreferrer"
      >
        {row.identifier}
        <ExternalLinkIcon aria-hidden="true" />
      </a>
    ),
  },
  {
    key: "title",
    header: "Title",
    sortValue: (row) => row.title,
    render: (row) => row.title,
  },
  {
    key: "team",
    header: "Team",
    sortValue: (row) => row.team,
    render: (row) => row.team,
  },
  {
    key: "urgency",
    header: "Urgency / Impact",
    sortValue: (row) => row.urgency,
    render: (row) => (
      <span className="visual-pill" data-sev="warning">
        <span aria-hidden="true">!</span>
        {`${row.urgency} / ${row.impact}`}
      </span>
    ),
  },
  {
    key: "assignee",
    header: "Assignee",
    sortValue: (row) => row.assignee,
    render: (row) => row.assignee ?? "Unassigned",
  },
];

function TrackerServiceView({
  range,
}: {
  readonly range: SeriesRange;
}): React.JSX.Element {
  const loaded = Loaded.fromQuery(useQuery(facetQuery("tracker")));
  const tracker = Loaded.getOrElse(loaded, undefined)?.data ?? null;

  return (
    <section
      className="eng-service-view"
      aria-label="Tracker work and Forum notices"
    >
      {loaded.status === "degraded" ? (
        <StaleNotice errors={loaded.errors} />
      ) : null}
      <div className="chart-grid">
        <SeriesChart
          preset="tracker-open"
          range={range}
          mode="stacked-area"
          title="Open Tracker issues"
          syncKey="svc-tracker"
        />
      </div>
      {tracker === null ? null : (
        <>
          <DataTable
            caption="Active Forum Notices"
            rows={tracker.activeNotices}
            rowKey={(row) => row.identifier}
            columns={TRACKER_NOTICE_COLUMNS}
            initialCap={15}
            emptyMessage="No active Forum notices."
          />
          <DataTable
            caption="Projects"
            rows={tracker.projects}
            rowKey={(row) => row.slug}
            columns={TRACKER_PROJECT_COLUMNS}
            initialCap={15}
            emptyMessage="No Tracker projects."
          />
          <DataTable
            caption="Urgent Issues"
            rows={tracker.urgentIssues}
            rowKey={(row) => row.identifier}
            columns={TRACKER_URGENT_COLUMNS}
            initialCap={15}
            emptyMessage="No urgent Tracker issues."
          />
        </>
      )}
    </section>
  );
}

export function renderEngineeringServiceView(
  id: string,
  range: SeriesRange,
): React.JSX.Element | null {
  switch (id) {
    case "ci":
      return <CiServiceView range={range} />;
    case "delivery":
    case "delivery-control-plane":
    case "delivery-data":
      return <DeliveryServiceView range={range} />;
    case "tracker":
      return <TrackerServiceView range={range} />;
    case "gitops":
      return <GitOpsServiceView range={range} />;
    default:
      return null;
  }
}
