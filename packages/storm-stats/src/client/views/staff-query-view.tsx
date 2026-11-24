import { useState, type SubmitEvent } from "react";
import { Filter, RotateCcw, Search, Users } from "lucide-react";
import {
  ACTIVITY_GROUPS,
  type ActivityGroup,
  type PlayerDirectoryRow,
  type PlayerSortField,
} from "@shepherdjerred/storm-stats/shared/contract.ts";
import {
  StaffQueryResponseSchema,
  type StaffQueryResponse,
} from "@shepherdjerred/storm-stats/shared/staff-contract.ts";
import {
  buildStaffQueryApiUrl,
  useApiQuery,
} from "@shepherdjerred/storm-stats/client/api.ts";
import {
  activityGroupLabel,
  formatHours,
  formatInt,
} from "@shepherdjerred/storm-stats/client/format.ts";
import { useAnnounce } from "@shepherdjerred/storm-stats/client/live-announcer.tsx";
import {
  buildRouteHref,
  DEFAULT_STAFF_QUERY_FILTERS,
  navigate,
  type StaffQueryFilters,
} from "@shepherdjerred/storm-stats/client/router.ts";
import type { ColumnAccessor } from "@shepherdjerred/storm-stats/client/sort.ts";
import { renderQueryGate } from "@shepherdjerred/storm-stats/client/components/brand.tsx";
import { useClientTableSort } from "@shepherdjerred/storm-stats/client/components/sortable-table.tsx";
import { PlayersDirectoryTable } from "./players-view.tsx";

const QUERY_ROW_ACCESSORS: Readonly<
  Record<PlayerSortField, ColumnAccessor<PlayerDirectoryRow>>
> = {
  name: { kind: "text", getValue: (row) => row.name },
  activityIndex: { kind: "number", getValue: (row) => row.activityIndex },
  activePlaytime: { kind: "number", getValue: (row) => row.activeMs },
  connectedPlaytime: { kind: "number", getValue: (row) => row.connectedMs },
  sessions: { kind: "number", getValue: (row) => row.sessionsCount },
  coins: { kind: "number", getValue: (row) => row.coins },
  powerLevel: { kind: "number", getValue: (row) => row.powerLevel },
  pvpKills: { kind: "number", getValue: (row) => row.pvpKills },
  lastSeen: {
    kind: "number",
    getValue: (row) => Date.parse(row.lastSeenAt) || 0,
  },
  firstSeen: {
    kind: "number",
    getValue: (row) => Date.parse(row.firstSeenAt) || 0,
  },
};

const QUERY_ROW_LABELS: Readonly<Record<PlayerSortField, string>> = {
  name: "Player",
  activityIndex: "Activity",
  activePlaytime: "Active Playtime",
  connectedPlaytime: "Connected",
  sessions: "Sessions",
  coins: "Coins",
  powerLevel: "Skill Power",
  pvpKills: "PvP K/D",
  lastSeen: "Last Seen",
  firstSeen: "First Seen",
};

export function StaffQueryView({
  filters,
}: {
  readonly filters: StaffQueryFilters;
}) {
  const apiUrl = buildStaffQueryApiUrl(filters);
  const query = useApiQuery(apiUrl, StaffQueryResponseSchema);

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1 id="page-heading" tabIndex={-1}>
            Player Query Builder
          </h1>
          <p className="page-subtitle">
            Slice cohorts by registration window, playtime bounds, Activity
            Index, platform, town, join address, GeoIP country, and bounce
            history.
          </p>
        </div>
        <span className="staff-banner-badge">
          <Filter size={14} aria-hidden="true" />
          <span>STAFF · TAILNET</span>
        </span>
      </div>

      <QueryBuilderForm key={apiUrl} initial={filters} />

      {renderQueryGate(query, "Running staff cohort query…", (data) => (
        <StaffQueryResults data={data} />
      ))}
    </div>
  );
}

function QueryBuilderForm({
  initial,
}: {
  readonly initial: StaffQueryFilters;
}) {
  const [draft, setDraft] = useState<StaffQueryFilters>(initial);
  const announce = useAnnounce();

  function toggleActivityGroup(group: ActivityGroup): void {
    setDraft((prev) => {
      const exists = prev.activityGroups.includes(group);
      return {
        ...prev,
        activityGroups: exists
          ? prev.activityGroups.filter((item) => item !== group)
          : [...prev.activityGroups, group],
      };
    });
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    navigate(buildRouteHref({ kind: "staff-query", filters: draft }));
    announce("Executed staff player cohort query.");
  }

  function handleReset(): void {
    setDraft(DEFAULT_STAFF_QUERY_FILTERS);
    navigate(
      buildRouteHref({
        kind: "staff-query",
        filters: DEFAULT_STAFF_QUERY_FILTERS,
      }),
    );
    announce("Reset staff query builder filters.");
  }

  return (
    <search>
      <form
        method="GET"
        action="/staff/query"
        className="query-builder-form"
        onSubmit={handleSubmit}
      >
        <fieldset className="filter-fieldset">
          <legend>Registration &amp; Last Seen Window</legend>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="sq-reg-after">Registered After</label>
              <input
                id="sq-reg-after"
                name="registeredAfter"
                type="date"
                value={draft.registeredAfter}
                onChange={(event) => {
                  setDraft({ ...draft, registeredAfter: event.target.value });
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="sq-reg-before">Registered Before</label>
              <input
                id="sq-reg-before"
                name="registeredBefore"
                type="date"
                value={draft.registeredBefore}
                onChange={(event) => {
                  setDraft({ ...draft, registeredBefore: event.target.value });
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="sq-seen-after">Last Seen After</label>
              <input
                id="sq-seen-after"
                name="lastSeenAfter"
                type="date"
                value={draft.lastSeenAfter}
                onChange={(event) => {
                  setDraft({ ...draft, lastSeenAfter: event.target.value });
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="sq-seen-before">Last Seen Before</label>
              <input
                id="sq-seen-before"
                name="lastSeenBefore"
                type="date"
                value={draft.lastSeenBefore}
                onChange={(event) => {
                  setDraft({ ...draft, lastSeenBefore: event.target.value });
                }}
              />
            </div>
          </div>
        </fieldset>

        <div className="grid-2">
          <fieldset className="filter-fieldset">
            <legend>Activity Index Groups</legend>
            <div className="choice-row">
              {ACTIVITY_GROUPS.map((group) => {
                const inputId = `sq-group-${group}`;
                const checked = draft.activityGroups.includes(group);
                return (
                  <div key={group} className="choice-item">
                    <input
                      id={inputId}
                      type="checkbox"
                      name="activityGroups"
                      value={group}
                      checked={checked}
                      onChange={() => {
                        toggleActivityGroup(group);
                      }}
                    />
                    <label htmlFor={inputId}>{activityGroupLabel(group)}</label>
                  </div>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="filter-fieldset">
            <legend>Client Platform</legend>
            <div className="choice-row">
              {(
                [
                  ["all", "All Platforms"],
                  ["java", "Java Edition"],
                  ["bedrock", "Bedrock (Geyser)"],
                ] as const
              ).map(([val, label]) => {
                const inputId = `sq-platform-${val}`;
                return (
                  <div key={val} className="choice-item">
                    <input
                      id={inputId}
                      type="radio"
                      name="platform"
                      value={val}
                      checked={draft.platform === val}
                      onChange={() => {
                        setDraft({ ...draft, platform: val });
                      }}
                    />
                    <label htmlFor={inputId}>{label}</label>
                  </div>
                );
              })}
            </div>
          </fieldset>
        </div>

        <fieldset className="filter-fieldset">
          <legend>Playtime, Ranks, Towns &amp; Network Attributes</legend>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="sq-min-hours">Min Active Hours</label>
              <input
                id="sq-min-hours"
                name="minPlaytimeHours"
                type="text"
                inputMode="decimal"
                placeholder="e.g. 5"
                value={draft.minPlaytimeHours}
                onChange={(event) => {
                  setDraft({ ...draft, minPlaytimeHours: event.target.value });
                }}
              />
            </div>

            <div className="field">
              <label htmlFor="sq-max-hours">Max Active Hours</label>
              <input
                id="sq-max-hours"
                name="maxPlaytimeHours"
                type="text"
                inputMode="decimal"
                placeholder="e.g. 250"
                value={draft.maxPlaytimeHours}
                onChange={(event) => {
                  setDraft({ ...draft, maxPlaytimeHours: event.target.value });
                }}
              />
            </div>

            <div className="field">
              <label htmlFor="sq-rank">Primary Group (LuckPerms)</label>
              <input
                id="sq-rank"
                name="primaryGroup"
                type="text"
                placeholder="e.g. default, builder"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                value={draft.primaryGroup}
                onChange={(event) => {
                  setDraft({ ...draft, primaryGroup: event.target.value });
                }}
              />
            </div>

            <div className="field">
              <label htmlFor="sq-town">Town Name</label>
              <input
                id="sq-town"
                name="town"
                type="text"
                placeholder="e.g. Spawn"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                value={draft.town}
                onChange={(event) => {
                  setDraft({ ...draft, town: event.target.value });
                }}
              />
            </div>

            <div className="field">
              <label htmlFor="sq-join-addr">Join Address</label>
              <input
                id="sq-join-addr"
                name="joinAddress"
                type="text"
                placeholder="e.g. ts-mc.net"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                value={draft.joinAddress}
                onChange={(event) => {
                  setDraft({ ...draft, joinAddress: event.target.value });
                }}
              />
            </div>

            <div className="field">
              <label htmlFor="sq-country">Country Code (ISO-2)</label>
              <input
                id="sq-country"
                name="countryCode"
                type="text"
                maxLength={2}
                placeholder="e.g. US"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                value={draft.countryCode}
                onChange={(event) => {
                  setDraft({
                    ...draft,
                    countryCode: event.target.value.toUpperCase(),
                  });
                }}
              />
            </div>
          </div>

          <div className="choice-row" style={{ marginBlockStart: "0.75rem" }}>
            <div className="choice-item">
              <input
                id="sq-has-bounce"
                type="checkbox"
                name="hasBounce"
                value="true"
                checked={draft.hasBounce}
                onChange={(event) => {
                  setDraft({ ...draft, hasBounce: event.target.checked });
                }}
              />
              <label htmlFor="sq-has-bounce">
                Only players with at least one connection bounce
              </label>
            </div>
          </div>
        </fieldset>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary">
            <Search size={16} aria-hidden="true" />
            <span>Run Player Query</span>
          </button>
          <button type="button" className="btn" onClick={handleReset}>
            <RotateCcw size={16} aria-hidden="true" />
            <span>Reset Filters</span>
          </button>
        </div>
      </form>
    </search>
  );
}

function StaffQueryResults({ data }: { readonly data: StaffQueryResponse }) {
  const { summary } = data;
  const { sortedRows, toggleColumn, directionFor } = useClientTableSort({
    rows: data.players,
    initial: { column: "activePlaytime", direction: "descending" },
    accessors: QUERY_ROW_ACCESSORS,
    labels: QUERY_ROW_LABELS,
  });

  return (
    <div className="stack-lg">
      <section aria-label="Matched cohort summary" className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">
            <span>Matched Players</span>
            <Users size={16} aria-hidden="true" />
          </div>
          <div className="kpi-value">{formatInt(summary.matchedPlayers)}</div>
          <div className="kpi-detail">
            {formatInt(summary.totalSessions)} total sessions
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">
            <span>Active &amp; Mean Playtime</span>
          </div>
          <div className="kpi-value">
            {formatHours(summary.totalActiveHours)}
          </div>
          <div className="kpi-detail">
            Mean: <strong>{formatHours(summary.meanActiveHours)}</strong> ·
            Connected: {formatHours(summary.totalConnectedHours)}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">
            <span>Activity Group Split</span>
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.35rem",
              marginBlockStart: "0.2rem",
            }}
          >
            <span className="pill pill-regular">
              Reg {formatInt(summary.regularCount)}
            </span>
            <span className="pill pill-active">
              Act {formatInt(summary.activeCount)}
            </span>
            <span className="pill pill-irregular">
              Irr {formatInt(summary.irregularCount)}
            </span>
            <span className="pill pill-inactive">
              Inact {formatInt(summary.inactiveCount)}
            </span>
          </div>
        </div>
      </section>

      {sortedRows.length === 0 ? (
        <div className="panel">
          <p className="panel-subtitle">
            Zero players matched the current query builder filters.
          </p>
        </div>
      ) : (
        <PlayersDirectoryTable
          rows={sortedRows}
          caption={`Matched query cohort (${formatInt(summary.matchedPlayers)} players)`}
          isStaff
          directionFor={directionFor}
          onSort={(field) => {
            toggleColumn(field);
          }}
        />
      )}
    </div>
  );
}
