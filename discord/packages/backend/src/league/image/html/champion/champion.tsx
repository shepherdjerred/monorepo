import "https://esm.sh/react@18.2.0";
import { renderItems } from "./item.tsx";
import { palette } from "../../assets/colors.ts";
// @deno-types="npm:@types/lodash"
import _ from "npm:lodash@4.17.21";
import { Champion } from "@discord/data";
import { summoner } from "../../../dataDragon/summoner.ts";
import { latestVersion } from "../../../dataDragon/version.ts";
import { CreepScore } from "./creepScore.tsx";
import { Gold } from "./gold.tsx";
import { Damage } from "./damage.tsx";
import { Kda } from "./kda.tsx";
import { Names } from "./names.tsx";
import { Lane } from "../lane/index.tsx";
import React from "https://esm.sh/react@18.2.0";

export function renderChampion(
  champion: Champion,
  highlight: boolean,
  durationInMinutes: number,
  damageMax: number
) {
  const items = renderItems(champion.items, champion.visionScore);

  const damagePercent = _.round((champion.damage / damageMax) * 100);

  const summs = _.map(champion.spells, (spell) => {
    const name = _.chain(summoner.data)
      .pickBy((summoner) => summoner.key === spell.toString())
      .keys()
      .first()
      .value();

    if (name === undefined) {
      throw new Error(`Summoner spell ${spell} not found`);
    }

    return (
      <img
        src={`https://ddragon.leagueoflegends.com/cdn/${latestVersion}/img/spell/${name}.png`}
        width="59"
        height="59"
        style={{
          backgroundColor: palette.blue[5],
          border: `1px solid ${palette.gold.bright}`,
        }}
      />
    );
  });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "2rem",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          color: "",
        }}
      >
        <Lane lane={champion.lane} />
        <span style={{ fontWeight: 700, width: "10rem" }}>
          {champion.level}
        </span>
      </div>

      <Names
        championName={champion.championName}
        summonerName={champion.summonerName}
        highlight={highlight}
      />

      <div style={{ display: "flex", gap: "3rem" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>{summs}</div>
        <div style={{ display: "flex", flexDirection: "row" }}>{items}</div>
      </div>

      <Kda
        kills={champion.kills}
        deaths={champion.deaths}
        assists={champion.assists}
        highlight={highlight}
      />
      <Damage
        value={champion.damage}
        percent={damagePercent}
        highlight={highlight}
      />
      <Gold value={champion.gold} durationInMinutes={durationInMinutes} />
      <CreepScore
        value={champion.creepScore}
        durationInMinutes={durationInMinutes}
      />
    </div>
  );
}
