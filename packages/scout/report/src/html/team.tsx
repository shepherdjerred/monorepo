import { renderChampion } from "@shepherdjerred/scout-report/html/champion/champion.tsx";
import { palette } from "@shepherdjerred/scout-report/assets/colors.ts";
import { font } from "@shepherdjerred/scout-report/assets/index.ts";
import type { Roster, Team } from "@shepherdjerred/scout-data";
import { sumBy } from "remeda";

export function renderTeam(team: Roster, side: Team, highlightNames: string[], durationInMinutes: number) {
  const teamKills = sumBy(team, (champion) => champion.kills);
  const teamDeaths = sumBy(team, (champion) => champion.deaths);
  const teamAssists = sumBy(team, (champion) => champion.assists);
  const teamGold = sumBy(team, (champion) => champion.gold);
  const mostDamage = Math.max(...team.map((champion) => champion.damage));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4rem" }}>
      <div style={{ display: "flex", gap: "6rem" }}>
        <span
          style={{
            color: side === "blue" ? palette.teams.blue : palette.teams.red,
            fontFamily: font.title,
            fontWeight: 700,
          }}
        >
          TEAM {side === "blue" ? 1 : 2}
        </span>
        <span style={{ fontWeight: 700 }}>
          {teamKills} / {teamDeaths} / {teamAssists}
        </span>
        <span style={{ fontWeight: 700 }}>{teamGold.toLocaleString()} gold</span>
      </div>
      {team.map((champion) =>
        renderChampion(champion, highlightNames.includes(champion.riotIdGameName), durationInMinutes, mostDamage),
      )}
    </div>
  );
}
