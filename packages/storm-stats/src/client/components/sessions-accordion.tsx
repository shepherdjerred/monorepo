import { ChevronDown } from "lucide-react";
import type { SessionSummary } from "@shepherdjerred/storm-stats/shared/contract.ts";
import {
  formatActiveRatio,
  formatDateTime,
  formatDurationMs,
  formatInt,
  formatModeLabel,
  formatPercent,
  formatRelativeTime,
  formatWorldLabel,
} from "@shepherdjerred/storm-stats/client/format.ts";
import { playerProfilePath } from "@shepherdjerred/storm-stats/client/router.ts";
import { PlatformBadge, PlayerAvatar } from "./brand.tsx";
import { SpaLink } from "./spa-link.tsx";

export function SessionsAccordion({
  sessions,
  showPlayerIdentity = true,
  emptyMessage = "No sessions recorded yet.",
}: {
  readonly sessions: readonly SessionSummary[];
  readonly showPlayerIdentity?: boolean;
  readonly emptyMessage?: string;
}) {
  if (sessions.length === 0) {
    return <p className="panel-subtitle">{emptyMessage}</p>;
  }

  return (
    <div className="sessions-list">
      {sessions.map((session) => {
        const activePct = formatActiveRatio(
          session.activeMs,
          session.connectedMs,
        );
        const afkMs = Math.max(0, session.connectedMs - session.activeMs);
        return (
          <details key={session.sessionId} className="session-disclosure">
            <summary>
              <div className="session-summary-primary">
                {showPlayerIdentity ? (
                  <>
                    <PlayerAvatar seed={session.playerUuid} />
                    <strong>{session.playerName}</strong>
                  </>
                ) : (
                  <strong>{formatDateTime(session.startedAt)}</strong>
                )}
                {session.ongoing ? (
                  <span className="pill pill-regular">Live Session</span>
                ) : (
                  <span className="panel-subtitle">
                    {formatRelativeTime(session.endedAt ?? session.startedAt)}
                  </span>
                )}
                <PlatformBadge platform={session.platform} />
              </div>
              <div className="session-summary-metrics">
                <span>
                  <strong>{formatDurationMs(session.connectedMs)}</strong> total
                </span>
                <span className="pill pill-active">
                  {formatPercent(activePct, 0)} active
                </span>
                <span>
                  {formatWorldLabel(session.primaryWorld)} ·{" "}
                  {formatModeLabel(session.primaryMode)}
                </span>
                <span>
                  {formatInt(session.pvpKills)} PvP /{" "}
                  {formatInt(session.mobKills)} mobs /{" "}
                  {formatInt(session.deaths)} deaths
                </span>
                <ChevronDown
                  size={16}
                  className="session-chevron"
                  aria-hidden="true"
                />
              </div>
            </summary>
            <div className="session-details-body">
              <div>
                <div className="session-kv-label">Session Window</div>
                <div className="session-kv-val">
                  {formatDateTime(session.startedAt)} →{" "}
                  {session.ongoing
                    ? "In progress"
                    : formatDateTime(session.endedAt)}
                </div>
              </div>
              <div>
                <div className="session-kv-label">Active vs AFK Time</div>
                <div className="session-kv-val">
                  {formatDurationMs(session.activeMs)} active ·{" "}
                  {formatDurationMs(afkMs)} AFK ({formatPercent(activePct, 1)})
                </div>
              </div>
              <div>
                <div className="session-kv-label">World &amp; Mode</div>
                <div className="session-kv-val">
                  {formatWorldLabel(session.primaryWorld)} (
                  {formatModeLabel(session.primaryMode)})
                </div>
              </div>
              <div>
                <div className="session-kv-label">Combat Summary</div>
                <div className="session-kv-val">
                  {formatInt(session.pvpKills)} player kills ·{" "}
                  {formatInt(session.mobKills)} mob kills ·{" "}
                  {formatInt(session.deaths)} deaths
                </div>
              </div>
              {showPlayerIdentity ? (
                <div>
                  <div className="session-kv-label">Player Profile</div>
                  <div className="session-kv-val">
                    <SpaLink href={playerProfilePath(session.playerName)}>
                      Inspect {session.playerName} →
                    </SpaLink>
                  </div>
                </div>
              ) : null}
            </div>
          </details>
        );
      })}
    </div>
  );
}
