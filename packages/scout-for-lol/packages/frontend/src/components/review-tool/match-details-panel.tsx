/**
 * Display details about the currently selected match
 */
import type { CompletedMatch, ArenaMatch } from "@scout-for-lol/data";
import { formatArenaPlacement } from "@scout-for-lol/data";

type MatchDetailsPanelProps = {
  match: CompletedMatch | ArenaMatch;
  hasTimeline?: boolean;
};

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes.toString()}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export function MatchDetailsPanel({ match, hasTimeline = true }: MatchDetailsPanelProps) {
  // TypeScript narrows discriminated union based on queue type check
  const isArena = match.queueType === "arena";

  return (
    <div className="bg-white rounded-lg border border-surface-200 p-4">
      <h3 className="text-lg font-semibold text-surface-900 mb-3">Match Details</h3>

      {/* Timeline Warning */}
      {!hasTimeline && (
        <div className="mb-3 p-3 rounded-lg bg-defeat-50 border border-defeat-200">
          <div className="flex items-start gap-2">
            <svg className="w-5 h-5 text-defeat-500 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <p className="text-sm font-medium text-defeat-800">Timeline data missing</p>
              <p className="text-xs text-defeat-600">
                This match cannot be used for review generation. Try selecting a different match.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {/* Queue Type */}
        <div className="flex justify-between items-center">
          <span className="text-sm text-surface-600">Queue:</span>
          <span className="text-sm font-medium text-surface-900 capitalize">{match.queueType ?? "Unknown"}</span>
        </div>

        {/* Duration */}
        <div className="flex justify-between items-center">
          <span className="text-sm text-surface-600">Duration:</span>
          <span className="text-sm font-medium text-surface-900">{formatDuration(match.durationInSeconds)}</span>
        </div>

        {/* Players */}
        <div className="border-t border-surface-200 pt-3">
          <h4 className="text-sm font-medium text-surface-700 mb-2">
            {match.players.length === 1 ? "Player" : "Players"} ({match.players.length})
          </h4>
          <div className="space-y-2">
            {match.players.map((player, idx) => (
              <div key={idx} className="bg-surface-50 rounded p-2">
                <div className="flex justify-between items-start mb-1">
                  <div>
                    <div className="text-sm font-medium text-surface-900">{player.playerConfig.alias || "Unknown"}</div>
                    <div className="text-xs text-surface-500">Riot ID</div>
                  </div>
                  {!isArena && "outcome" in player && (
                    <span
                      className={`text-xs px-2 py-1 rounded ${
                        player.outcome === "Victory" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                      }`}
                    >
                      {player.outcome}
                    </span>
                  )}
                  {isArena && "placement" in player && (
                    <span className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-800">
                      {formatArenaPlacement(player.placement)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-surface-600">
                  <span>
                    <strong>Champion:</strong> {player.champion.championName}
                  </span>
                  {!isArena && "lane" in player.champion && player.champion.lane && (
                    <span className="capitalize">
                      <strong>Lane:</strong> {player.champion.lane}
                    </span>
                  )}
                  <span>
                    <strong>KDA:</strong> {player.champion.kills}/{player.champion.deaths}/{player.champion.assists}
                  </span>
                </div>
                {!isArena && "rankAfterMatch" in player && player.rankAfterMatch && (
                  <div className="text-xs text-surface-600 mt-1">
                    <strong>Rank:</strong> {player.rankAfterMatch.tier} {player.rankAfterMatch.division}
                    {` (${player.rankAfterMatch.lp.toString()} LP)`}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Team Composition (for non-arena matches) */}
        {!isArena && "teams" in match && (
          <div className="border-t border-surface-200 pt-3">
            <h4 className="text-sm font-medium text-surface-700 mb-2">Teams</h4>
            <div className="grid grid-cols-2 gap-3">
              {/* Blue Team */}
              <div className="bg-blue-50 rounded p-3 border border-blue-200">
                <div className="text-xs font-semibold text-blue-900 mb-2">Blue Team</div>
                <div className="space-y-1.5">
                  {match.teams.blue.map((champion, idx) => (
                    <div key={idx} className="text-xs">
                      <div className="font-medium text-blue-900">{champion.riotIdGameName}</div>
                      <div className="text-blue-700">{champion.championName}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Red Team */}
              <div className="bg-red-50 rounded p-3 border border-red-200">
                <div className="text-xs font-semibold text-red-900 mb-2">Red Team</div>
                <div className="space-y-1.5">
                  {match.teams.red.map((champion, idx) => (
                    <div key={idx} className="text-xs">
                      <div className="font-medium text-red-900">{champion.riotIdGameName}</div>
                      <div className="text-red-700">{champion.championName}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Arena Teams */}
        {isArena && (
          <div className="border-t border-surface-200 pt-3">
            <h4 className="text-sm font-medium text-surface-700 mb-2">Arena Teams ({match.teams.length})</h4>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {match.teams
                .slice()
                .sort((a, b) => a.placement - b.placement)
                .map((team) => (
                  <div
                    key={team.teamId}
                    className="flex justify-between items-center text-xs bg-surface-50 rounded px-2 py-1"
                  >
                    <span className="font-medium text-surface-900">{formatArenaPlacement(team.placement)}</span>
                    <span className="text-surface-600">{team.players.map((p) => p.championName).join(" & ")}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
