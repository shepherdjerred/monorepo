import { type ArenaTeam } from "@scout-for-lol/data";
import { palette } from "#src/assets/colors.ts";
import { TeamHeader } from "#src/html/arena/team-header.tsx";
import { PlayerColumn } from "#src/html/arena/player-column.tsx";

export function TeamCard({
  team,
  highlightNames,
}: {
  team: ArenaTeam;
  highlightNames: string[];
}) {
  const maxTeamDamage = Math.max(...team.players.map((p) => p.damage), 0);
  const teamSize = team.players.length;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: 24,
        padding: "40px 32px 32px",
        background: palette.blue[7],
        border: `1px solid ${palette.gold[5]}`,
        borderRadius: 8,
        boxShadow: `inset 0 0 32px rgba(200, 170, 110, 0.08)`,
      }}
    >
      <TeamHeader team={team} />
      <div
        style={{
          height: 1,
          width: "100%",
          display: "flex",
          background: palette.gold[5],
          opacity: 0.6,
        }}
      />
      <div
        style={{
          display: "flex",
          gap: 20,
        }}
      >
        {team.players.map((player) => (
          <PlayerColumn
            key={player.riotIdGameName}
            player={player}
            highlight={highlightNames.includes(player.riotIdGameName)}
            maxTeamDamage={maxTeamDamage}
            teamSize={teamSize}
          />
        ))}
      </div>
    </div>
  );
}
