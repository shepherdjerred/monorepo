import { Sparkles, UserCheck, Users } from "lucide-react";
import {
  OnlineActivityResponseSchema,
  type OnlineActivityResponse,
  type RetentionCohortRow,
} from "@shepherdjerred/storm-stats/shared/contract.ts";
import { useApiQuery } from "@shepherdjerred/storm-stats/client/api.ts";
import {
  formatInt,
  formatMinutes,
  formatPercent,
} from "@shepherdjerred/storm-stats/client/format.ts";
import type { ColumnAccessor } from "@shepherdjerred/storm-stats/client/sort.ts";
import { renderQueryGate } from "@shepherdjerred/storm-stats/client/components/brand.tsx";
import {
  DailyPlayersChart,
  DailyPlaytimeChart,
} from "@shepherdjerred/storm-stats/client/components/charts-line.tsx";
import {
  ActivityCalendarHeatmap,
  PacificPunchcard,
  PlayerbaseHealthCard,
} from "@shepherdjerred/storm-stats/client/components/charts-matrix.tsx";
import {
  ResponsiveTable,
  SortableTh,
  useClientTableSort,
} from "@shepherdjerred/storm-stats/client/components/sortable-table.tsx";

type CohortSortKey =
  | "cohortWeek"
  | "newPlayers"
  | "week1Percent"
  | "week2Percent"
  | "week4Percent";

const COHORT_ACCESSORS: Readonly<
  Record<CohortSortKey, ColumnAccessor<RetentionCohortRow>>
> = {
  cohortWeek: { kind: "text", getValue: (row) => row.cohortWeek },
  newPlayers: { kind: "number", getValue: (row) => row.newPlayers },
  week1Percent: { kind: "number", getValue: (row) => row.week1Percent },
  week2Percent: { kind: "number", getValue: (row) => row.week2Percent },
  week4Percent: { kind: "number", getValue: (row) => row.week4Percent },
};

const COHORT_LABELS: Readonly<Record<CohortSortKey, string>> = {
  cohortWeek: "Cohort Week",
  newPlayers: "New Players",
  week1Percent: "Week +1",
  week2Percent: "Week +2",
  week4Percent: "Week +4",
};

function retentionBadgeClass(pct: number): string {
  if (pct >= 40) {
    return "pill pill-regular";
  }
  if (pct >= 20) {
    return "pill pill-active";
  }
  return pct >= 8 ? "pill pill-irregular" : "pill pill-inactive";
}

export function ActivityView() {
  const query = useApiQuery("/api/v1/activity", OnlineActivityResponseSchema);

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1 id="page-heading" tabIndex={-1}>
            Online Activity &amp; Retention
          </h1>
          <p className="page-subtitle">
            180-day player trends, Pacific time punchcard, multi-month activity
            calendar, and weekly new-player cohort retention.
          </p>
        </div>
        <div className="page-meta">Timezone: America/Los_Angeles</div>
      </div>

      {renderQueryGate(query, "Loading activity & retention…", (data) => (
        <ActivityContent data={data} />
      ))}
    </div>
  );
}

function ActivityContent({ data }: { readonly data: OnlineActivityResponse }) {
  const { firstSessionEngagement } = data;

  return (
    <div className="stack-lg">
      <div className="grid-2">
        <div className="panel">
          <div className="panel-header">
            <h2>First-Session Engagement</h2>
            <span className="panel-subtitle">
              10+ active minutes conversion benchmark
            </span>
          </div>
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="kpi-label">
                <span>10+ Min Conversion</span>
                <Sparkles size={16} aria-hidden="true" />
              </div>
              <div className="kpi-value">
                {formatPercent(firstSessionEngagement.tenMinutePercent, 1)}
              </div>
              <div className="kpi-detail">
                <strong>
                  {formatInt(firstSessionEngagement.reachedTenActiveMinutes)}
                </strong>{" "}
                of {formatInt(firstSessionEngagement.completedFirstSessions)}{" "}
                completed first sessions
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-label">
                <span>Mean First Active Time</span>
                <UserCheck size={16} aria-hidden="true" />
              </div>
              <div className="kpi-value">
                {formatMinutes(firstSessionEngagement.meanActiveMinutes)}
              </div>
              <div className="kpi-detail">
                Across{" "}
                <Users
                  size={13}
                  aria-hidden="true"
                  style={{ verticalAlign: "-2px" }}
                />{" "}
                {formatInt(firstSessionEngagement.completedFirstSessions)}{" "}
                newcomers
              </div>
            </div>
          </div>
        </div>

        <PlayerbaseHealthCard groups={data.playerbaseGroups} />
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-header">
            <h2>180-Day Unique vs New vs Returning</h2>
            <span className="panel-subtitle">Daily active roster mix</span>
          </div>
          <DailyPlayersChart
            points={data.dailySeries180d}
            caption="180-day daily unique, returning, and new players"
          />
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>180-Day Connected vs Active Playtime</h2>
            <span className="panel-subtitle">Server hours per day</span>
          </div>
          <DailyPlaytimeChart
            points={data.dailySeries180d}
            caption="180-day daily connected and active playtime hours"
          />
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>24×7 Pacific Time Punchcard</h2>
          <span className="panel-subtitle">
            Monday–Sunday × 00:00–23:00 community peak hours
          </span>
        </div>
        <PacificPunchcard cells={data.punchcard} />
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>Activity Calendar Heatmap</h2>
          <span className="panel-subtitle">
            Daily active playtime intensity across the past year
          </span>
        </div>
        <ActivityCalendarHeatmap
          days={data.calendar730d}
          caption="Server daily active playtime heatmap"
          maxDays={371}
        />
      </div>

      <CohortRetentionSection cohorts={data.retentionCohorts} />
    </div>
  );
}

function CohortRetentionSection({
  cohorts,
}: {
  readonly cohorts: readonly RetentionCohortRow[];
}) {
  const { sortedRows, toggleColumn, directionFor } = useClientTableSort({
    rows: cohorts,
    initial: { column: "cohortWeek", direction: "descending" },
    accessors: COHORT_ACCESSORS,
    labels: COHORT_LABELS,
  });

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Weekly New-Player Cohort Retention</h2>
        <span className="panel-subtitle">
          Percentage of each cohort returning in Week +1, +2, and +4
        </span>
      </div>

      {sortedRows.length === 0 ? (
        <p className="panel-subtitle">No weekly retention cohorts yet.</p>
      ) : (
        <ResponsiveTable caption="Weekly new-player cohort retention rates">
          <thead>
            <tr>
              <SortableTh
                label="Cohort Week"
                direction={directionFor("cohortWeek")}
                onActivate={() => {
                  toggleColumn("cohortWeek");
                }}
              />
              <SortableTh
                label="New Players"
                numeric
                direction={directionFor("newPlayers")}
                onActivate={() => {
                  toggleColumn("newPlayers");
                }}
              />
              <SortableTh
                label="Week +1"
                numeric
                direction={directionFor("week1Percent")}
                onActivate={() => {
                  toggleColumn("week1Percent");
                }}
              />
              <SortableTh
                label="Week +2"
                numeric
                direction={directionFor("week2Percent")}
                onActivate={() => {
                  toggleColumn("week2Percent");
                }}
              />
              <SortableTh
                label="Week +4"
                numeric
                direction={directionFor("week4Percent")}
                onActivate={() => {
                  toggleColumn("week4Percent");
                }}
              />
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.cohortWeek}>
                <th scope="row" className="mono">
                  {row.cohortWeek}
                </th>
                <td data-label="New Players" className="num-col">
                  <strong>{formatInt(row.newPlayers)}</strong>
                </td>
                <td data-label="Week +1" className="num-col">
                  <span className={retentionBadgeClass(row.week1Percent)}>
                    {formatPercent(row.week1Percent, 1)}
                  </span>{" "}
                  <span className="panel-subtitle">
                    ({formatInt(row.week1Retained)})
                  </span>
                </td>
                <td data-label="Week +2" className="num-col">
                  <span className={retentionBadgeClass(row.week2Percent)}>
                    {formatPercent(row.week2Percent, 1)}
                  </span>{" "}
                  <span className="panel-subtitle">
                    ({formatInt(row.week2Retained)})
                  </span>
                </td>
                <td data-label="Week +4" className="num-col">
                  <span className={retentionBadgeClass(row.week4Percent)}>
                    {formatPercent(row.week4Percent, 1)}
                  </span>{" "}
                  <span className="panel-subtitle">
                    ({formatInt(row.week4Retained)})
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </ResponsiveTable>
      )}
    </div>
  );
}
