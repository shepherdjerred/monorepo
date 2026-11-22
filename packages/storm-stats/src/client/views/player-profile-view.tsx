import { useId, useState } from "react";
import { Clock, Shield, Wifi } from "lucide-react";
import type { ViewerRole } from "@shepherdjerred/storm-stats/shared/contract.ts";
import {
  PlayerProfileResponseSchema,
  type PlayerGameplayCard,
  type PlayerProfileIdentity,
  type PlayerProfileResponse,
} from "@shepherdjerred/storm-stats/shared/player-contract.ts";
import {
  buildPlayerApiUrl,
  useApiQuery,
} from "@shepherdjerred/storm-stats/client/api.ts";
import {
  formatActiveRatio,
  formatDateTime,
  formatDurationMs,
  formatHours,
  formatInt,
  formatModeLabel,
  formatPercent,
  formatPing,
  formatRelativeTime,
  formatTitleIdentifier,
  formatWorldLabel,
} from "@shepherdjerred/storm-stats/client/format.ts";
import { setPageDocumentTitle } from "@shepherdjerred/storm-stats/client/router.ts";
import {
  ActivityGroupBadge,
  PlatformBadge,
  PlayerAvatar,
  renderQueryGate,
} from "@shepherdjerred/storm-stats/client/components/brand.tsx";
import {
  ActivityCalendarHeatmap,
  ShareBreakdownPanel,
} from "@shepherdjerred/storm-stats/client/components/charts-matrix.tsx";
import { SessionsAccordion } from "@shepherdjerred/storm-stats/client/components/sessions-accordion.tsx";
import {
  SearchableTabPanel,
  TabListBar,
  type TabDescriptor,
} from "@shepherdjerred/storm-stats/client/components/tabs.tsx";
import {
  PlayerCombatPanel,
  PlayerGameplayPanel,
} from "./player-profile-panels.tsx";
import { PlayerStaffInspectPanel } from "./player-staff-panel.tsx";

type ProfileTabId = "overview" | "gameplay" | "combat" | "staff";

export function PlayerProfileView({
  playerId,
  viewerRole,
}: {
  readonly playerId: string;
  readonly viewerRole: ViewerRole;
}) {
  const query = useApiQuery(
    buildPlayerApiUrl(playerId),
    PlayerProfileResponseSchema,
  );

  if (query.state.status === "success") {
    setPageDocumentTitle(`${query.state.data.player.name} · Player Profile`);
  }

  return (
    <div className="stack-lg">
      {query.state.status === "success" ? null : (
        <div className="page-header">
          <div>
            <h1 id="page-heading" tabIndex={-1}>
              Player Profile · {playerId}
            </h1>
            <p className="page-subtitle">
              Inspecting Storm session history, gameplay progression, and combat
              statistics.
            </p>
          </div>
        </div>
      )}

      {renderQueryGate(query, `Loading profile for ${playerId}…`, (data) => (
        <PlayerProfileLoaded
          key={data.player.uuid}
          data={data}
          viewerRole={viewerRole}
        />
      ))}
    </div>
  );
}

function formatOnlineStatusText(player: PlayerProfileIdentity): string {
  const base = player.afk ? "Online (AFK)" : "Online Now";
  const worldSuffix =
    player.currentWorld === null
      ? ""
      : ` · ${formatWorldLabel(player.currentWorld)}`;
  const modeSuffix =
    player.currentMode === null
      ? ""
      : ` (${formatModeLabel(player.currentMode)})`;
  return `${base}${worldSuffix}${modeSuffix}`;
}

function formatTownBadge(gameplay: PlayerGameplayCard | null): string | null {
  const townName = gameplay?.townName ?? null;
  if (townName === null) {
    return null;
  }
  const townRole = gameplay?.townRole ?? null;
  return townRole === null
    ? townName
    : `${townName} · ${formatTitleIdentifier(townRole)}`;
}

function PlayerIdentityHeader({
  player,
  gameplay,
}: {
  readonly player: PlayerProfileIdentity;
  readonly gameplay: PlayerGameplayCard | null;
}) {
  const townLabel = formatTownBadge(gameplay);

  return (
    <div className="panel">
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <PlayerAvatar seed={player.uuid} large />
          <div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "0.55rem",
              }}
            >
              <h1
                id="page-heading"
                tabIndex={-1}
                style={{ margin: 0, fontSize: "1.65rem" }}
              >
                {player.name}
              </h1>
              {player.nickname === null ||
              player.nickname === player.name ? null : (
                <span className="pill pill-neutral">“{player.nickname}”</span>
              )}
              {player.online ? (
                <span className="pill pill-regular">
                  {formatOnlineStatusText(player)}
                </span>
              ) : (
                <span className="pill pill-inactive">
                  Last seen {formatRelativeTime(player.lastSeenAt)}
                </span>
              )}
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.45rem",
                marginBlockStart: "0.5rem",
              }}
            >
              <ActivityGroupBadge
                group={player.activityGroup}
                index={player.activityIndex}
              />
              <span className="pill pill-purple">
                <Shield size={12} aria-hidden="true" />
                <span>{formatTitleIdentifier(player.primaryGroup)}</span>
              </span>
              {townLabel === null ? null : (
                <span className="pill pill-gold">{townLabel}</span>
              )}
              <PlatformBadge
                platform={player.platform}
                version={player.clientVersion}
              />
            </div>
          </div>
        </div>

        <div style={{ textAlign: "end", fontSize: "0.82rem" }}>
          <div className="mono panel-subtitle">{player.uuid}</div>
          <div style={{ marginBlockStart: "0.25rem" }}>
            First seen: <strong>{formatDateTime(player.firstSeenAt)}</strong>
          </div>
          <div>
            Last seen: <strong>{formatDateTime(player.lastSeenAt)}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlayerProfileLoaded({
  data,
  viewerRole,
}: {
  readonly data: PlayerProfileResponse;
  readonly viewerRole: ViewerRole;
}) {
  const { player, gameplay } = data;
  const isStaff = viewerRole === "staff";
  const [activeTab, setActiveTab] = useState<ProfileTabId>("overview");
  const baseId = useId();

  const overviewTabDomId = `${baseId}-tab-overview`;
  const gameplayTabDomId = `${baseId}-tab-gameplay`;
  const combatTabDomId = `${baseId}-tab-combat`;
  const staffTabDomId = `${baseId}-tab-staff`;

  const tabs: TabDescriptor<ProfileTabId>[] = [
    {
      id: "overview",
      tabDomId: overviewTabDomId,
      label: "Overview & Activity",
      badge: formatInt(player.sessionsCount),
    },
    {
      id: "gameplay",
      tabDomId: gameplayTabDomId,
      label: "Storm Gameplay",
      badge:
        gameplay === null ? undefined : `Lv ${formatInt(gameplay.powerLevel)}`,
    },
    {
      id: "combat",
      tabDomId: combatTabDomId,
      label: "PvP & PvE",
      badge: `${formatInt(data.combat.pvpKills)}K`,
    },
    ...(isStaff
      ? [
          {
            id: "staff" as const,
            tabDomId: staffTabDomId,
            label: "Staff Inspect",
          },
        ]
      : []),
  ];

  const resolvedTab: ProfileTabId =
    !isStaff && activeTab === "staff" ? "overview" : activeTab;

  const activePct = formatActiveRatio(player.activeMs, player.connectedMs);

  return (
    <div className="stack-lg">
      <PlayerIdentityHeader player={player} gameplay={gameplay} />

      <section aria-label="Player lifetime statistics" className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">
            <span>Active Playtime</span>
            <Clock size={16} aria-hidden="true" />
          </div>
          <div className="kpi-value">{formatDurationMs(player.activeMs)}</div>
          <div className="kpi-detail">
            {formatPercent(activePct, 1)} of{" "}
            <strong>{formatDurationMs(player.connectedMs)}</strong> connected ·{" "}
            {formatDurationMs(player.afkMs)} AFK
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">
            <span>Total Sessions</span>
            <Clock size={16} aria-hidden="true" />
          </div>
          <div className="kpi-value">{formatInt(player.sessionsCount)}</div>
          <div className="kpi-detail">
            Mean: <strong>{formatDurationMs(player.meanSessionMs)}</strong> ·
            Longest:{" "}
            <strong>{formatDurationMs(player.longestSessionMs)}</strong>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">
            <span>Latency (Min / Avg / Max)</span>
            <Wifi size={16} aria-hidden="true" />
          </div>
          <div className="kpi-value mono">{formatPing(player.pingAvgMs)}</div>
          <div className="kpi-detail mono">
            Min {formatPing(player.pingMinMs)} · Max{" "}
            {formatPing(player.pingMaxMs)}
          </div>
        </div>
      </section>

      <div className="tabs-container">
        <TabListBar
          ariaLabel="Player profile sections"
          tabs={tabs}
          activeTab={resolvedTab}
          onSelect={setActiveTab}
        />

        <SearchableTabPanel
          tabDomId={overviewTabDomId}
          active={resolvedTab === "overview"}
          onBeforeMatchActivate={() => {
            setActiveTab("overview");
          }}
        >
          <div className="panel">
            <div className="panel-header">
              <h2>365-Day Personal Activity Calendar</h2>
              <span className="panel-subtitle">
                Daily active hours over the past year
              </span>
            </div>
            <ActivityCalendarHeatmap
              days={data.calendar365d}
              caption={`${player.name} 365-day activity heatmap`}
              maxDays={365}
            />
          </div>

          <div className="grid-2">
            <ShareBreakdownPanel
              title="World Playtime Breakdown"
              subtitle="Personal active hours by world"
              items={data.worldBreakdown.map((world) => ({
                key: world.world,
                label: world.label,
                sharePercent: world.sharePercent,
                detail: `${formatHours(world.activeHours)} active`,
              }))}
            />

            <ShareBreakdownPanel
              title="Game Mode Breakdown"
              subtitle="Personal active hours by mode"
              items={data.modeBreakdown.map((mode) => ({
                key: mode.mode,
                label: mode.label,
                sharePercent: mode.sharePercent,
                detail: `${formatHours(mode.activeHours)} active`,
              }))}
            />
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>Recent Sessions</h2>
              <span className="panel-subtitle">
                Latest {formatInt(data.recentSessions.length)} sessions for{" "}
                {player.name}
              </span>
            </div>
            <SessionsAccordion
              sessions={data.recentSessions}
              showPlayerIdentity={false}
            />
          </div>
        </SearchableTabPanel>

        <SearchableTabPanel
          tabDomId={gameplayTabDomId}
          active={resolvedTab === "gameplay"}
          onBeforeMatchActivate={() => {
            setActiveTab("gameplay");
          }}
        >
          <PlayerGameplayPanel gameplay={data.gameplay} />
        </SearchableTabPanel>

        <SearchableTabPanel
          tabDomId={combatTabDomId}
          active={resolvedTab === "combat"}
          onBeforeMatchActivate={() => {
            setActiveTab("combat");
          }}
        >
          <PlayerCombatPanel combat={data.combat} />
        </SearchableTabPanel>

        {isStaff ? (
          <SearchableTabPanel
            tabDomId={staffTabDomId}
            active={resolvedTab === "staff"}
            onBeforeMatchActivate={() => {
              setActiveTab("staff");
            }}
          >
            <PlayerStaffInspectPanel playerId={player.uuid} />
          </SearchableTabPanel>
        ) : null}
      </div>
    </div>
  );
}
