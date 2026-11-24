import { useState, type SubmitEvent } from "react";
import { RotateCcw, Search } from "lucide-react";
import {
  ActivityGroupSchema,
  PlatformSchema,
  PlayersDirectoryResponseSchema,
  type PlayerDirectoryRow,
  type PlayerSortField,
  type ViewerRole,
} from "@shepherdjerred/storm-stats/shared/contract.ts";
import {
  buildPlayersApiUrl,
  useApiQuery,
} from "@shepherdjerred/storm-stats/client/api.ts";
import {
  formatDurationMs,
  formatInt,
  formatKdr,
  formatRelativeTime,
} from "@shepherdjerred/storm-stats/client/format.ts";
import { useAnnounce } from "@shepherdjerred/storm-stats/client/live-announcer.tsx";
import {
  buildRouteHref,
  DEFAULT_PLAYERS_QUERY,
  navigate,
  type PlayersRouteQuery,
} from "@shepherdjerred/storm-stats/client/router.ts";
import {
  formatSortAnnouncement,
  type SortDirection,
} from "@shepherdjerred/storm-stats/client/sort.ts";
import {
  ActivityGroupBadge,
  PlatformBadge,
  PlayerIdentityLink,
  renderQueryGate,
} from "@shepherdjerred/storm-stats/client/components/brand.tsx";
import {
  ResponsiveTable,
  SortableTh,
} from "@shepherdjerred/storm-stats/client/components/sortable-table.tsx";
import { SpaLink } from "@shepherdjerred/storm-stats/client/components/spa-link.tsx";

function computeNextSortDir(
  currentSort: PlayerSortField,
  currentDir: "asc" | "desc",
  clickedField: PlayerSortField,
): "asc" | "desc" {
  if (currentSort === clickedField) {
    return currentDir === "asc" ? "desc" : "asc";
  }
  return clickedField === "name" ? "asc" : "desc";
}

export function PlayersView({
  queryParams,
  viewerRole,
}: {
  readonly queryParams: PlayersRouteQuery;
  readonly viewerRole: ViewerRole;
}) {
  const apiUrl = buildPlayersApiUrl(queryParams);
  const query = useApiQuery(apiUrl, PlayersDirectoryResponseSchema);
  const announce = useAnnounce();

  function handleServerSort(field: PlayerSortField, label: string): void {
    const nextDir = computeNextSortDir(
      queryParams.sort,
      queryParams.dir,
      field,
    );
    const nextQuery: PlayersRouteQuery = {
      ...queryParams,
      sort: field,
      dir: nextDir,
      page: 1,
    };
    navigate(buildRouteHref({ kind: "players", query: nextQuery }), {
      preserveScroll: true,
    });
    const spokenDirection: SortDirection =
      nextDir === "asc" ? "ascending" : "descending";
    const rowCount =
      query.state.status === "success" ? query.state.data.items.length : 0;
    announce(formatSortAnnouncement(label, spokenDirection, rowCount));
  }

  function sortDirectionFor(field: PlayerSortField): SortDirection | undefined {
    if (queryParams.sort !== field) {
      return undefined;
    }
    return queryParams.dir === "asc" ? "ascending" : "descending";
  }

  const formKey = `${queryParams.q}|${queryParams.group}|${queryParams.platform}|${String(queryParams.pageSize)}`;

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1 id="page-heading" tabIndex={-1}>
            Players Directory
          </h1>
          <p className="page-subtitle">
            Search, filter, and sort every Java and Bedrock player across The
            Storm.
          </p>
        </div>
        {query.state.status === "success" ? (
          <div className="page-meta">
            {formatInt(query.state.data.total)} matched players
          </div>
        ) : null}
      </div>

      <PlayersFilterBar key={formKey} initial={queryParams} />

      {renderQueryGate(query, "Loading player directory…", (data) => {
        const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
        const startIdx =
          data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
        const endIdx = Math.min(data.total, data.page * data.pageSize);

        return (
          <div>
            {data.items.length === 0 ? (
              <div className="panel">
                <p className="panel-subtitle">
                  No players matched the active search and filter criteria.
                </p>
              </div>
            ) : (
              <PlayersDirectoryTable
                rows={data.items}
                caption={`Players directory (${formatInt(data.total)} total)`}
                isStaff={viewerRole === "staff"}
                directionFor={sortDirectionFor}
                onSort={handleServerSort}
              />
            )}

            <div className="pagination-bar">
              <span>
                Showing <strong>{formatInt(startIdx)}</strong>–
                <strong>{formatInt(endIdx)}</strong> of{" "}
                <strong>{formatInt(data.total)}</strong> players (Page{" "}
                {formatInt(data.page)} of {formatInt(totalPages)})
              </span>
              <div className="form-actions">
                {data.page > 1 ? (
                  <SpaLink
                    className="btn"
                    href={buildRouteHref({
                      kind: "players",
                      query: { ...queryParams, page: data.page - 1 },
                    })}
                  >
                    ← Previous
                  </SpaLink>
                ) : null}
                {data.page < totalPages ? (
                  <SpaLink
                    className="btn"
                    href={buildRouteHref({
                      kind: "players",
                      query: { ...queryParams, page: data.page + 1 },
                    })}
                  >
                    Next →
                  </SpaLink>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PlayersFilterBar({
  initial,
}: {
  readonly initial: PlayersRouteQuery;
}) {
  const [q, setQ] = useState(initial.q);
  const [group, setGroup] = useState<PlayersRouteQuery["group"]>(initial.group);
  const [platform, setPlatform] = useState<PlayersRouteQuery["platform"]>(
    initial.platform,
  );
  const [pageSize, setPageSize] = useState(initial.pageSize);
  const announce = useAnnounce();

  function handleSubmit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    const next: PlayersRouteQuery = {
      ...initial,
      q: q.trim(),
      group,
      platform,
      pageSize,
      page: 1,
    };
    navigate(buildRouteHref({ kind: "players", query: next }));
    announce("Updated player directory filters.");
  }

  function handleReset(): void {
    setQ("");
    setGroup("all");
    setPlatform("all");
    setPageSize(25);
    navigate(buildRouteHref({ kind: "players", query: DEFAULT_PLAYERS_QUERY }));
    announce("Reset player directory filters.");
  }

  return (
    <search>
      <form
        method="GET"
        action="/players"
        className="filter-form"
        onSubmit={handleSubmit}
      >
        <div className="field" style={{ flex: "2 1 16rem" }}>
          <label htmlFor="players-search-q">Player Name or UUID</label>
          <input
            id="players-search-q"
            name="q"
            type="search"
            value={q}
            placeholder="e.g. Notch or 069a79f4-..."
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(event) => {
              setQ(event.target.value);
            }}
          />
        </div>

        <div className="field">
          <label htmlFor="players-filter-group">Activity Group</label>
          <select
            id="players-filter-group"
            name="group"
            value={group}
            onChange={(event) => {
              const parsed = ActivityGroupSchema.safeParse(event.target.value);
              setGroup(parsed.success ? parsed.data : "all");
            }}
          >
            <option value="all">All Groups</option>
            <option value="regular">Regular</option>
            <option value="active">Active</option>
            <option value="irregular">Irregular</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="players-filter-platform">Platform</label>
          <select
            id="players-filter-platform"
            name="platform"
            value={platform}
            onChange={(event) => {
              const parsed = PlatformSchema.safeParse(event.target.value);
              setPlatform(parsed.success ? parsed.data : "all");
            }}
          >
            <option value="all">All Platforms</option>
            <option value="java">Java Edition</option>
            <option value="bedrock">Bedrock (Geyser)</option>
          </select>
        </div>

        <div
          className="field"
          style={{ flex: "0 1 8.5rem", minInlineSize: "8rem" }}
        >
          <label htmlFor="players-filter-size">Per Page</label>
          <select
            id="players-filter-size"
            name="pageSize"
            value={String(pageSize)}
            onChange={(event) => {
              setPageSize(Number.parseInt(event.target.value, 10) || 25);
            }}
          >
            <option value="25">25 rows</option>
            <option value="50">50 rows</option>
            <option value="100">100 rows</option>
          </select>
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary">
            <Search size={16} aria-hidden="true" />
            <span>Search</span>
          </button>
          <button type="button" className="btn" onClick={handleReset}>
            <RotateCcw size={16} aria-hidden="true" />
            <span>Reset</span>
          </button>
        </div>
      </form>
    </search>
  );
}

export function PlayersDirectoryTable({
  rows,
  caption,
  isStaff,
  directionFor,
  onSort,
}: {
  readonly rows: readonly PlayerDirectoryRow[];
  readonly caption: string;
  readonly isStaff: boolean;
  readonly directionFor: (field: PlayerSortField) => SortDirection | undefined;
  readonly onSort: (field: PlayerSortField, label: string) => void;
}) {
  return (
    <ResponsiveTable caption={caption}>
      <thead>
        <tr>
          <SortableTh
            label="Player"
            direction={directionFor("name")}
            onActivate={() => {
              onSort("name", "Player");
            }}
          />
          <SortableTh
            label="Activity"
            direction={directionFor("activityIndex")}
            onActivate={() => {
              onSort("activityIndex", "Activity");
            }}
          />
          <SortableTh
            label="Active Playtime"
            numeric
            direction={directionFor("activePlaytime")}
            onActivate={() => {
              onSort("activePlaytime", "Active Playtime");
            }}
          />
          <SortableTh
            label="Connected"
            numeric
            direction={directionFor("connectedPlaytime")}
            onActivate={() => {
              onSort("connectedPlaytime", "Connected");
            }}
          />
          <SortableTh
            label="Sessions"
            numeric
            direction={directionFor("sessions")}
            onActivate={() => {
              onSort("sessions", "Sessions");
            }}
          />
          <th scope="col">Town</th>
          <SortableTh
            label="Coins"
            numeric
            direction={directionFor("coins")}
            onActivate={() => {
              onSort("coins", "Coins");
            }}
          />
          <SortableTh
            label="Skill Power"
            numeric
            direction={directionFor("powerLevel")}
            onActivate={() => {
              onSort("powerLevel", "Skill Power");
            }}
          />
          <SortableTh
            label="PvP K/D"
            numeric
            direction={directionFor("pvpKills")}
            onActivate={() => {
              onSort("pvpKills", "PvP K/D");
            }}
          />
          <th scope="col">Platform</th>
          <SortableTh
            label="Last Seen"
            direction={directionFor("lastSeen")}
            onActivate={() => {
              onSort("lastSeen", "Last Seen");
            }}
          />
          {isStaff ? (
            <>
              <th scope="col">Country</th>
              <th scope="col">Join Address</th>
              <th scope="col" className="num-col">
                Bounces
              </th>
            </>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.uuid}>
            <th scope="row">
              <PlayerIdentityLink
                uuid={row.uuid}
                name={row.name}
                nickname={row.nickname}
                online={row.online}
              />
            </th>
            <td data-label="Activity">
              <ActivityGroupBadge
                group={row.activityGroup}
                index={row.activityIndex}
              />
            </td>
            <td data-label="Active Playtime" className="num-col">
              <strong>{formatDurationMs(row.activeMs)}</strong>
            </td>
            <td data-label="Connected" className="num-col">
              {formatDurationMs(row.connectedMs)}
            </td>
            <td data-label="Sessions" className="num-col">
              {formatInt(row.sessionsCount)}
            </td>
            <td data-label="Town">{row.townName ?? "—"}</td>
            <td data-label="Coins" className="num-col">
              <span className="pill pill-gold">{formatInt(row.coins)}</span>
            </td>
            <td data-label="Skill Power" className="num-col">
              {formatInt(row.powerLevel)}
            </td>
            <td data-label="PvP K/D" className="num-col mono">
              {formatInt(row.pvpKills)}/{formatInt(row.pvpDeaths)} (
              {formatKdr(row.pvpKills, row.pvpDeaths)})
            </td>
            <td data-label="Platform">
              <PlatformBadge
                platform={row.platform}
                version={row.clientVersion}
              />
            </td>
            <td data-label="Last Seen">
              {row.online ? (
                <span className="pill pill-regular">Online now</span>
              ) : (
                formatRelativeTime(row.lastSeenAt)
              )}
            </td>
            {isStaff ? (
              <>
                <td data-label="Country">
                  {row.staff?.countryName ?? row.staff?.countryCode ?? "—"}
                </td>
                <td data-label="Join Address" className="mono">
                  {row.staff?.lastJoinAddress ?? "—"}
                </td>
                <td data-label="Bounces" className="num-col">
                  {formatInt(row.staff?.bouncesCount ?? 0)}
                </td>
              </>
            ) : null}
          </tr>
        ))}
      </tbody>
    </ResponsiveTable>
  );
}
