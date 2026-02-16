import { type ArenaMatch } from "@scout-for-lol/data";
import { formatDuration } from "@scout-for-lol/report/html/arena/utils.ts";

export function MatchHeader({ match, highlightNames }: { match: ArenaMatch; highlightNames: string[] }) {
  const trackedTeams = match.teams.filter((team) =>
    team.players.some((p) => highlightNames.includes(p.riotIdGameName)),
  );

  if (trackedTeams.length === 1) {
    const trackedTeam = trackedTeams[0];
    if (!trackedTeam) {
      return null;
    }
    const isVictory = trackedTeam.placement <= 4;

    return (
      <div style={{ display: "flex", alignItems: "center", gap: 24, marginBottom: 8 }}>
        <div
          style={{
            fontSize: 48,
            fontWeight: 800,
            color: isVictory ? "#10b981" : "#ef4444",
            textShadow: "0 2px 4px rgba(0, 0, 0, 0.3)",
          }}
        >
          {isVictory ? "VICTORY" : "DEFEAT"}
        </div>
        <div style={{ display: "flex", fontSize: 24, opacity: 0.9, gap: 0 }}>
          {formatDuration(match.durationInSeconds)}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", fontSize: 48, opacity: 0.9, marginBottom: 8, gap: 0 }}>
      {formatDuration(match.durationInSeconds)}
    </div>
  );
}
