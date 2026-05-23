import { type ArenaTeam } from "@scout-for-lol/data";
import { palette } from "#src/assets/colors.ts";
import { TeamHeader } from "#src/html/arena/team-header.tsx";
import { PlayerColumn } from "#src/html/arena/player-column.tsx";
import { sumBy } from "remeda";

export function TeamCard({
  team,
  width,
  highlightNames,
}: {
  team: ArenaTeam;
  width: number;
  highlightNames: string[];
}) {
  const maxTeamDamage = Math.max(...team.players.map((p) => p.damage), 0);
  const totalTeamDamage = sumBy(team.players, (player) => player.damage);
  const teamSize = team.players.length;

  return (
    <div
      style={{
        width,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: 22,
        padding: "36px 26px 28px",
        background: palette.blue[7],
        border: `1px solid ${palette.gold[5]}`,
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
          gap: 0,
          flex: 1,
          alignItems: "stretch",
        }}
      >
        {team.players.map((player, index) => (
          <PlayerColumn
            key={player.riotIdGameName}
            player={player}
            highlight={highlightNames.includes(player.riotIdGameName)}
            isFirst={index === 0}
            isLast={index === team.players.length - 1}
            maxTeamDamage={maxTeamDamage}
            totalTeamDamage={totalTeamDamage}
            teamSize={teamSize}
          />
        ))}
      </div>
    </div>
  );
}
