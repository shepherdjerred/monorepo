import React from "https://esm.sh/react@18.2.0";
import { renderChampion } from "./champion.tsx";
// @deno-types="npm:@types/lodash"
import _ from "npm:lodash@4.17.21";
import { palette } from "../assets/colors.ts";
import { font } from "../assets/index.ts";
import { Roster } from "@discord/data";
import { Team } from "@discord/data";

export function renderTeam(
  team: Roster,
  side: Team,
  highlight: string,
  durationInMinutes: number
) {
  const teamKills = _.sumBy(team, (champion) => champion.kills);
  const teamDeaths = _.sumBy(team, (champion) => champion.deaths);
  const teamAssists = _.sumBy(team, (champion) => champion.assists);
  const teamGold = _.sumBy(team, (champion) => champion.gold);
  const mostDamage = _.chain(team)
    .map((champion) => champion.damage)
    .max()
    .value();

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
        <span style={{ fontWeight: 700 }}>
          {teamGold.toLocaleString()} gold
        </span>
      </div>
      {_.map(team, (champion) =>
        renderChampion(
          champion,
          champion.championName === highlight,
          durationInMinutes,
          mostDamage
        )
      )}
    </div>
  );
}
