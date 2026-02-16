import { type ArenaTeam, getArenaTeamName } from "@scout-for-lol/data";
import { PlacementBadge } from "@scout-for-lol/report/html/arena/placement-badge.tsx";
import { TeamStats } from "@scout-for-lol/report/html/arena/team-stats.tsx";

export function TeamHeader({ team }: { team: ArenaTeam }) {
  const teamKills = team.players.reduce((sum, p) => sum + p.kills, 0);
  const teamDeaths = team.players.reduce((sum, p) => sum + p.deaths, 0);
  const teamAssists = team.players.reduce((sum, p) => sum + p.assists, 0);
  const teamGold = team.players.reduce((sum, p) => sum + p.gold, 0);
  const teamName = getArenaTeamName(team.teamId);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <PlacementBadge placement={team.placement} />
        <span style={{ fontSize: 20, fontWeight: 600, opacity: 0.8 }}>
          Team {teamName}
        </span>
      </div>
      <TeamStats kills={teamKills} deaths={teamDeaths} assists={teamAssists} />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 20,
          opacity: 0.7,
        }}
      >
        Gold:{" "}
        <span style={{ fontSize: 24, fontWeight: 600, color: "#fbbf24" }}>
          {teamGold}
        </span>
      </div>
    </div>
  );
}
