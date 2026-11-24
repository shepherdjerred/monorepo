import { Activity, Clock, Flame, Users, Zap } from "lucide-react";
import {
  ServerOverviewResponseSchema,
  type OnlinePlayerSummary,
  type ServerOverviewResponse,
} from "@shepherdjerred/storm-stats/shared/contract.ts";
import { useApiQuery } from "@shepherdjerred/storm-stats/client/api.ts";
import {
  formatActiveRatio,
  formatDateTime,
  formatDurationMs,
  formatHours,
  formatInt,
  formatMinutes,
  formatModeLabel,
  formatPercent,
  formatPing,
  formatRelativeTime,
  formatWorldLabel,
} from "@shepherdjerred/storm-stats/client/format.ts";
import { playerProfilePath } from "@shepherdjerred/storm-stats/client/router.ts";
import {
  PlayerAvatar,
  renderQueryGate,
} from "@shepherdjerred/storm-stats/client/components/brand.tsx";
import {
  DailyPlayersChart,
  DailyPlaytimeChart,
} from "@shepherdjerred/storm-stats/client/components/charts-line.tsx";
import {
  PlayerbaseHealthCard,
  ShareBreakdownPanel,
} from "@shepherdjerred/storm-stats/client/components/charts-matrix.tsx";
import { SessionsAccordion } from "@shepherdjerred/storm-stats/client/components/sessions-accordion.tsx";
import { SpaLink } from "@shepherdjerred/storm-stats/client/components/spa-link.tsx";

export function OverviewView() {
  const query = useApiQuery("/api/v1/overview", ServerOverviewResponseSchema);

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1 id="page-heading" tabIndex={-1}>
            Server Overview
          </h1>
          <p className="page-subtitle">
            Live player telemetry, 30-day activity velocity, world share, and
            recent sessions on The Storm.
          </p>
        </div>
        {query.state.status === "success" ? (
          <div className="page-meta">
            Last ingest:{" "}
            {query.state.data.lastIngestAt === null
              ? "awaiting batch"
              : formatRelativeTime(query.state.data.lastIngestAt)}
          </div>
        ) : null}
      </div>

      {renderQueryGate(query, "Loading server overview…", (data) => (
        <OverviewContent data={data} />
      ))}
    </div>
  );
}

function OverviewContent({ data }: { readonly data: ServerOverviewResponse }) {
  const { kpis } = data;
  const activeRatio30d = formatActiveRatio(
    kpis.activeHours30d * 3_600_000,
    kpis.connectedHours30d * 3_600_000,
  );
  const generatedMs = Date.parse(data.generatedAt);
  const refNowMs = Number.isNaN(generatedMs) ? Date.now() : generatedMs;

  return (
    <div className="stack-lg">
      <section aria-label="Key server metrics" className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">
            <span>Unique Players (30d)</span>
            <Users size={16} aria-hidden="true" />
          </div>
          <div className="kpi-value">{formatInt(kpis.uniquePlayers30d)}</div>
          <div className="kpi-detail">
            24h: <strong>{formatInt(kpis.uniquePlayers24h)}</strong> · 7d:{" "}
            <strong>{formatInt(kpis.uniquePlayers7d)}</strong> · All-time:{" "}
            <strong>{formatInt(kpis.totalPlayers)}</strong>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">
            <span>New Players (30d)</span>
            <Zap size={16} aria-hidden="true" />
          </div>
          <div className="kpi-value">{formatInt(kpis.newPlayers30d)}</div>
          <div className="kpi-detail">
            24h: <strong>{formatInt(kpis.newPlayers24h)}</strong> · 7d:{" "}
            <strong>{formatInt(kpis.newPlayers7d)}</strong> joined The Storm
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">
            <span>Active vs Connected (30d)</span>
            <Activity size={16} aria-hidden="true" />
          </div>
          <div className="kpi-value">
            {formatHours(kpis.activeHours30d)} /{" "}
            {formatHours(kpis.connectedHours30d)}
          </div>
          <div className="kpi-detail">
            {formatPercent(activeRatio30d, 0)} active · All-time:{" "}
            <strong>{formatHours(kpis.totalActiveHours)}</strong>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">
            <span>Mean Session (30d)</span>
            <Clock size={16} aria-hidden="true" />
          </div>
          <div className="kpi-value">
            {formatMinutes(kpis.meanSessionMinutes30d)}
          </div>
          <div className="kpi-detail">
            Mean active:{" "}
            <strong>{formatMinutes(kpis.meanActiveMinutes30d)}</strong> ·{" "}
            {formatInt(kpis.completedSessions30d)} sessions
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">
            <span>Peak Concurrent Online</span>
            <Flame size={16} aria-hidden="true" />
          </div>
          <div className="kpi-value">
            {formatInt(kpis.peakOnline30d)} /{" "}
            {formatInt(kpis.peakOnlineAllTime)}
          </div>
          <div className="kpi-detail">
            30d / All-Time
            {kpis.peakOnlineAt === null
              ? ""
              : ` · Record ${formatDateTime(kpis.peakOnlineAt)}`}
          </div>
        </div>
      </section>

      <OnlineRosterPanel
        onlineNow={data.onlineNow}
        maxPlayers={data.maxPlayers}
        players={data.onlinePlayers}
        referenceNowMs={refNowMs}
      />

      <div className="grid-2">
        <div className="panel">
          <div className="panel-header">
            <h2>30-Day Daily Players</h2>
            <span className="panel-subtitle">Unique, returning &amp; new</span>
          </div>
          <DailyPlayersChart
            points={data.dailyActivity30d}
            caption="Daily unique, returning, and new players over the last 30 days"
          />
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>30-Day Playtime Hours</h2>
            <span className="panel-subtitle">Active vs total connected</span>
          </div>
          <DailyPlaytimeChart
            points={data.dailyActivity30d}
            caption="Daily connected and active playtime hours over the last 30 days"
          />
        </div>
      </div>

      <div className="grid-3">
        <PlayerbaseHealthCard groups={data.playerbaseGroups} />

        <ShareBreakdownPanel
          title="World Playtime Share"
          subtitle="Active hours by world bucket"
          items={data.worldBreakdown.map((item) => ({
            key: item.world,
            label: item.label,
            sharePercent: item.sharePercent,
            detail: `${formatHours(item.activeHours)} active`,
          }))}
        />

        <ShareBreakdownPanel
          title="Game Mode Share"
          subtitle="Active hours & unique players"
          items={data.modeBreakdown.map((item) => ({
            key: item.mode,
            label: item.label,
            sharePercent: item.sharePercent,
            detail: `${formatHours(item.activeHours)} · ${formatInt(item.uniquePlayers)} players`,
          }))}
        />
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>Recent Sessions</h2>
          <span className="panel-subtitle">
            Expand any session for timestamps, AFK split, and combat breakdown
          </span>
        </div>
        <SessionsAccordion sessions={data.recentSessions} />
      </div>
    </div>
  );
}

function OnlineRosterPanel({
  onlineNow,
  maxPlayers,
  players,
  referenceNowMs,
}: {
  readonly onlineNow: number;
  readonly maxPlayers: number;
  readonly players: readonly OnlinePlayerSummary[];
  readonly referenceNowMs: number;
}) {
  return (
    <div className="panel">
      <div className="panel-header">
        <h2>
          Online Now ({formatInt(onlineNow)} / {formatInt(maxPlayers)})
        </h2>
        <span className="panel-subtitle">
          Live snapshot of connected Storm players
        </span>
      </div>

      {players.length === 0 ? (
        <p className="panel-subtitle">
          No players are currently online on {`ts-mc.net`}.
        </p>
      ) : (
        <div className="online-roster-grid">
          {players.map((player) => {
            const startedMs = Date.parse(player.sessionStartedAt);
            const durationMs = Number.isNaN(startedMs)
              ? 0
              : Math.max(0, referenceNowMs - startedMs);
            return (
              <SpaLink
                key={player.uuid}
                href={playerProfilePath(player.name)}
                className="online-player-card"
              >
                <div className="session-summary-primary">
                  <PlayerAvatar seed={player.uuid} />
                  <div>
                    <div>
                      <strong>{player.name}</strong>
                    </div>
                    <div className="panel-subtitle">
                      {formatWorldLabel(player.world)} ·{" "}
                      {formatModeLabel(player.mode)}
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: "end" }}>
                  <div>
                    {player.afk ? (
                      <span className="pill pill-irregular">AFK</span>
                    ) : (
                      <span className="pill pill-regular">
                        {formatDurationMs(durationMs)}
                      </span>
                    )}
                  </div>
                  <div className="panel-subtitle mono">
                    {formatPing(player.pingMs)}
                  </div>
                </div>
              </SpaLink>
            );
          })}
        </div>
      )}
    </div>
  );
}
