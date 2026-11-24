import { ShieldAlert } from "lucide-react";
import {
  BOUNCE_CATEGORIES,
  type BounceCategory,
} from "@shepherdjerred/storm-stats/shared/contract.ts";
import {
  StaffBouncesResponseSchema,
  type StaffBouncesResponse,
} from "@shepherdjerred/storm-stats/shared/staff-contract.ts";
import { useApiQuery } from "@shepherdjerred/storm-stats/client/api.ts";
import {
  formatBounceCategory,
  formatDateTime,
  formatInt,
  formatRelativeTime,
} from "@shepherdjerred/storm-stats/client/format.ts";
import type { ColumnAccessor } from "@shepherdjerred/storm-stats/client/sort.ts";
import {
  PlayerIdentityLink,
  renderQueryGate,
} from "@shepherdjerred/storm-stats/client/components/brand.tsx";
import {
  ResponsiveTable,
  SortableTh,
  useClientTableSort,
} from "@shepherdjerred/storm-stats/client/components/sortable-table.tsx";

type BounceLogRow = StaffBouncesResponse["recentBounces"][number];

const BOUNCE_ACCESSORS: Readonly<
  Record<"occurredAt" | "playerName" | "category", ColumnAccessor<BounceLogRow>>
> = {
  occurredAt: {
    kind: "number",
    getValue: (row) => Date.parse(row.occurredAt) || 0,
  },
  playerName: { kind: "text", getValue: (row) => row.playerName },
  category: { kind: "text", getValue: (row) => row.category },
};

function categoryPillClass(category: BounceCategory): string {
  switch (category) {
    case "banned":
    case "kicked":
      return "pill pill-danger";
    case "allowlist":
    case "maintenance":
      return "pill pill-irregular";
    case "full":
      return "pill pill-active";
    case "other":
      return "pill pill-inactive";
  }
}

export function StaffBouncesView() {
  const query = useApiQuery("/api/staff/bounces", StaffBouncesResponseSchema);

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1 id="page-heading" tabIndex={-1}>
            Joins &amp; Connection Bounces
          </h1>
          <p className="page-subtitle">
            Refused login attempts, allowlist blocks, maintenance gates, bans,
            and kicks on The Storm.
          </p>
        </div>
        <span className="staff-banner-badge">
          <ShieldAlert size={14} aria-hidden="true" />
          <span>STAFF · TAILNET</span>
        </span>
      </div>

      {renderQueryGate(query, "Loading connection bounces…", (data) => (
        <BouncesContent data={data} />
      ))}
    </div>
  );
}

function BouncesContent({ data }: { readonly data: StaffBouncesResponse }) {
  const byCategoryMap = new Map(
    data.byCategory.map((entry) => [entry.category, entry]),
  );

  const { sortedRows, toggleColumn, directionFor } = useClientTableSort({
    rows: data.recentBounces,
    initial: { column: "occurredAt", direction: "descending" },
    accessors: BOUNCE_ACCESSORS,
    labels: {
      occurredAt: "Occurred",
      playerName: "Player",
      category: "Category",
    },
  });

  return (
    <div className="stack-lg">
      <section aria-label="Bounce categories summary" className="kpi-grid">
        {BOUNCE_CATEGORIES.map((category) => {
          const summary = byCategoryMap.get(category) ?? {
            category,
            count: 0,
            uniquePlayers: 0,
          };
          return (
            <div key={category} className="kpi-card">
              <div className="kpi-label">
                <span>{formatBounceCategory(category)}</span>
                <span className={categoryPillClass(category)}>{category}</span>
              </div>
              <div className="kpi-value">{formatInt(summary.count)}</div>
              <div className="kpi-detail">
                <strong>{formatInt(summary.uniquePlayers)}</strong> unique
                players affected
              </div>
            </div>
          );
        })}
      </section>

      <div className="panel">
        <div className="panel-header">
          <h2>Recent Connection Bounces</h2>
          <span className="panel-subtitle">
            Latest {formatInt(sortedRows.length)} rejected or kicked login
            events
          </span>
        </div>

        {sortedRows.length === 0 ? (
          <p className="panel-subtitle">
            No connection bounces have been recorded.
          </p>
        ) : (
          <ResponsiveTable caption="Recent connection bounces log">
            <thead>
              <tr>
                <SortableTh
                  label="Occurred"
                  direction={directionFor("occurredAt")}
                  onActivate={() => {
                    toggleColumn("occurredAt");
                  }}
                />
                <SortableTh
                  label="Player"
                  direction={directionFor("playerName")}
                  onActivate={() => {
                    toggleColumn("playerName");
                  }}
                />
                <SortableTh
                  label="Category"
                  direction={directionFor("category")}
                  onActivate={() => {
                    toggleColumn("category");
                  }}
                />
                <th scope="col">Reason</th>
                <th scope="col">Join Address</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr key={row.eventId}>
                  <th scope="row">
                    <div>{formatRelativeTime(row.occurredAt)}</div>
                    <div className="panel-subtitle">
                      {formatDateTime(row.occurredAt)}
                    </div>
                  </th>
                  <td data-label="Player">
                    <PlayerIdentityLink
                      uuid={row.playerUuid}
                      name={row.playerName}
                    />
                  </td>
                  <td data-label="Category">
                    <span className={categoryPillClass(row.category)}>
                      {formatBounceCategory(row.category)}
                    </span>
                  </td>
                  <td data-label="Reason">
                    {row.reason.length === 0 ? "—" : row.reason}
                  </td>
                  <td data-label="Join Address" className="mono">
                    {row.joinAddress ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </ResponsiveTable>
        )}
      </div>
    </div>
  );
}
