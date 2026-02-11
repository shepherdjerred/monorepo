import { type ArenaMatch } from "@shepherdjerred/scout-data";
import { MatchHeader } from "@shepherdjerred/scout-report/html/arena/match-header.tsx";
import { TeamCard } from "@shepherdjerred/scout-report/html/arena/team-card.tsx";

export function ArenaReport(props: { match: ArenaMatch }) {
  const { match } = props;
  const highlightNames = match.players.map((p) => p.champion.riotIdGameName);

  const sortedTeams = [...match.teams]
    .sort((a, b) => a.placement - b.placement)
    .filter((team) => team.players.some((p) => highlightNames.includes(p.riotIdGameName)));

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        padding: 48,
        gap: 24,
        fontFamily: "Inter",
        color: "#e5e7eb",
        background: "#0b1220",
      }}
    >
      <MatchHeader match={match} highlightNames={highlightNames} />
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {sortedTeams.map((team) => (
          <TeamCard key={team.teamId} team={team} highlightNames={highlightNames} />
        ))}
      </div>
    </div>
  );
}
