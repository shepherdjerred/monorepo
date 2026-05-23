import { type ArenaMatch } from "@scout-for-lol/data";
import { palette } from "#src/assets/colors.ts";
import { font } from "#src/assets/index.ts";
import { PageHeader } from "#src/html/arena/page-header.tsx";
import { TeamCard } from "#src/html/arena/team-card.tsx";
import { getArenaTeamCardWidth } from "#src/html/arena/utils.ts";

export function ArenaReport(props: { match: ArenaMatch }) {
  const { match } = props;
  const highlightNames = match.players.map((p) => p.champion.riotIdGameName);

  const sortedTeams = [...match.teams]
    .toSorted((a, b) => a.placement - b.placement)
    .filter((team) =>
      team.players.some((p) => highlightNames.includes(p.riotIdGameName)),
    );

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: 48,
        gap: 32,
        backgroundColor: palette.blue.gradient.dark.start,
        color: palette.grey[1],
        fontFamily: font.body,
      }}
    >
      <PageHeader match={match} />
      <div
        style={{
          display: "flex",
          gap: 32,
          flex: 1,
          alignItems: "stretch",
          justifyContent: "center",
        }}
      >
        {sortedTeams.map((team) => (
          <TeamCard
            key={team.teamId}
            team={team}
            width={getArenaTeamCardWidth(team.players.length)}
            highlightNames={highlightNames}
          />
        ))}
      </div>
    </div>
  );
}
