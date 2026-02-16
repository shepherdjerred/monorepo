import { type ArenaTeam } from "@scout-for-lol/data";
import { TeamHeader } from "@scout-for-lol/report/html/arena/team-header.tsx";
import { PlayerCard } from "@scout-for-lol/report/html/arena/player-card.tsx";
import { getTeamStyling } from "@scout-for-lol/report/html/arena/utils.ts";

export function TeamCard({
  team,
  highlightNames,
}: {
  team: ArenaTeam;
  highlightNames: string[];
}) {
  const hasTrackedPlayer = team.players.some((p) =>
    highlightNames.includes(p.riotIdGameName),
  );
  const teamStyle = getTeamStyling(team.placement, hasTrackedPlayer);

  const maxTeamDamage = Math.max(...team.players.map((p) => p.damage), 0);

  return (
    <div
      key={team.teamId}
      style={{
        display: "flex",
        flexDirection: "column",
        borderRadius: 20,
        padding: 32,
        background: teamStyle.background,
        border: teamStyle.border,
        boxShadow: teamStyle.boxShadow,
        position: "relative",
      }}
    >
      <TeamHeader team={team} />
      <div style={{ display: "flex", flexDirection: "column" }}>
        {team.players.map((player, idx) => (
          <PlayerCard
            key={idx}
            player={player}
            highlight={highlightNames.includes(player.riotIdGameName)}
            maxTeamDamage={maxTeamDamage}
          />
        ))}
      </div>
    </div>
  );
}
