import { Globe } from "lucide-react";
import {
  StaffNetworkResponseSchema,
  type StaffNetworkResponse,
} from "@shepherdjerred/storm-stats/shared/staff-contract.ts";
import { useApiQuery } from "@shepherdjerred/storm-stats/client/api.ts";
import {
  formatDateTime,
  formatInt,
  formatPercent,
  formatPing,
} from "@shepherdjerred/storm-stats/client/format.ts";
import type { ColumnAccessor } from "@shepherdjerred/storm-stats/client/sort.ts";
import { renderQueryGate } from "@shepherdjerred/storm-stats/client/components/brand.tsx";
import { ShareBreakdownPanel } from "@shepherdjerred/storm-stats/client/components/charts-matrix.tsx";
import {
  ResponsiveTable,
  SortableTh,
  useClientTableSort,
} from "@shepherdjerred/storm-stats/client/components/sortable-table.tsx";

type CountryRow = StaffNetworkResponse["countries"][number];
type JoinAddressRow = StaffNetworkResponse["joinAddresses"][number];

const COUNTRY_ACCESSORS: Readonly<
  Record<
    "countryName" | "players" | "sharePercent" | "pingAvgMs",
    ColumnAccessor<CountryRow>
  >
> = {
  countryName: { kind: "text", getValue: (row) => row.countryName },
  players: { kind: "number", getValue: (row) => row.players },
  sharePercent: { kind: "number", getValue: (row) => row.sharePercent },
  pingAvgMs: {
    kind: "number",
    getValue: (row) => row.pingAvgMs ?? Number.MAX_SAFE_INTEGER,
  },
};

const ADDRESS_ACCESSORS: Readonly<
  Record<
    "joinAddress" | "players" | "sessions" | "lastSeenAt",
    ColumnAccessor<JoinAddressRow>
  >
> = {
  joinAddress: { kind: "text", getValue: (row) => row.joinAddress },
  players: { kind: "number", getValue: (row) => row.players },
  sessions: { kind: "number", getValue: (row) => row.sessions },
  lastSeenAt: {
    kind: "number",
    getValue: (row) => Date.parse(row.lastSeenAt) || 0,
  },
};

export function StaffNetworkView() {
  const query = useApiQuery("/api/staff/network", StaffNetworkResponseSchema);

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1 id="page-heading" tabIndex={-1}>
            Network &amp; Geolocation
          </h1>
          <p className="page-subtitle">
            Tailnet-only country distribution, regional latency, and Minecraft
            join hostnames (<code>ts-mc.net</code>, <code>mc.ts-mc.net</code>,{" "}
            <code>join.ts-mc.net</code>).
          </p>
        </div>
        <span className="staff-banner-badge">
          <Globe size={14} aria-hidden="true" />
          <span>STAFF · TAILNET</span>
        </span>
      </div>

      {renderQueryGate(query, "Loading staff network telemetry…", (data) => (
        <div className="stack-lg">
          <ShareBreakdownPanel
            title="Country Distribution"
            subtitle="Player share by GeoIP country"
            items={data.countries.slice(0, 8).map((country) => ({
              key: country.countryCode,
              label: `${country.countryName} (${country.countryCode})`,
              sharePercent: country.sharePercent,
              detail: `${formatInt(country.players)} players · ${formatPing(country.pingAvgMs)}`,
            }))}
          />

          <div className="grid-2">
            <CountriesTable rows={data.countries} />
            <JoinAddressesTable rows={data.joinAddresses} />
          </div>
        </div>
      ))}
    </div>
  );
}

function CountriesTable({ rows }: { readonly rows: readonly CountryRow[] }) {
  const { sortedRows, toggleColumn, directionFor } = useClientTableSort({
    rows,
    initial: { column: "players", direction: "descending" },
    accessors: COUNTRY_ACCESSORS,
    labels: {
      countryName: "Country",
      players: "Players",
      sharePercent: "Share",
      pingAvgMs: "Avg Ping",
    },
  });

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Countries &amp; Mean Ping</h2>
      </div>
      {sortedRows.length === 0 ? (
        <p className="panel-subtitle">No geolocation data recorded yet.</p>
      ) : (
        <ResponsiveTable caption="Player distribution by country" compact>
          <thead>
            <tr>
              <SortableTh
                label="Country"
                direction={directionFor("countryName")}
                onActivate={() => {
                  toggleColumn("countryName");
                }}
              />
              <SortableTh
                label="Players"
                numeric
                direction={directionFor("players")}
                onActivate={() => {
                  toggleColumn("players");
                }}
              />
              <SortableTh
                label="Share"
                numeric
                direction={directionFor("sharePercent")}
                onActivate={() => {
                  toggleColumn("sharePercent");
                }}
              />
              <SortableTh
                label="Avg Ping"
                numeric
                direction={directionFor("pingAvgMs")}
                onActivate={() => {
                  toggleColumn("pingAvgMs");
                }}
              />
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.countryCode}>
                <th scope="row">
                  {row.countryName}{" "}
                  <span className="mono panel-subtitle">
                    ({row.countryCode})
                  </span>
                </th>
                <td data-label="Players" className="num-col">
                  <strong>{formatInt(row.players)}</strong>
                </td>
                <td data-label="Share" className="num-col">
                  {formatPercent(row.sharePercent, 1)}
                </td>
                <td data-label="Avg Ping" className="num-col mono">
                  {formatPing(row.pingAvgMs)}
                </td>
              </tr>
            ))}
          </tbody>
        </ResponsiveTable>
      )}
    </div>
  );
}

function JoinAddressesTable({
  rows,
}: {
  readonly rows: readonly JoinAddressRow[];
}) {
  const { sortedRows, toggleColumn, directionFor } = useClientTableSort({
    rows,
    initial: { column: "sessions", direction: "descending" },
    accessors: ADDRESS_ACCESSORS,
    labels: {
      joinAddress: "Join Address",
      players: "Unique Players",
      sessions: "Sessions",
      lastSeenAt: "Last Seen",
    },
  });

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Join Addresses</h2>
      </div>
      {sortedRows.length === 0 ? (
        <p className="panel-subtitle">No join addresses recorded yet.</p>
      ) : (
        <ResponsiveTable caption="Server join addresses usage" compact>
          <thead>
            <tr>
              <SortableTh
                label="Join Address"
                direction={directionFor("joinAddress")}
                onActivate={() => {
                  toggleColumn("joinAddress");
                }}
              />
              <SortableTh
                label="Unique Players"
                numeric
                direction={directionFor("players")}
                onActivate={() => {
                  toggleColumn("players");
                }}
              />
              <SortableTh
                label="Sessions"
                numeric
                direction={directionFor("sessions")}
                onActivate={() => {
                  toggleColumn("sessions");
                }}
              />
              <SortableTh
                label="Last Seen"
                direction={directionFor("lastSeenAt")}
                onActivate={() => {
                  toggleColumn("lastSeenAt");
                }}
              />
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.joinAddress}>
                <th scope="row" className="mono">
                  {row.joinAddress}
                </th>
                <td data-label="Unique Players" className="num-col">
                  {formatInt(row.players)}
                </td>
                <td data-label="Sessions" className="num-col">
                  <strong>{formatInt(row.sessions)}</strong>
                </td>
                <td data-label="Last Seen">{formatDateTime(row.lastSeenAt)}</td>
              </tr>
            ))}
          </tbody>
        </ResponsiveTable>
      )}
    </div>
  );
}
