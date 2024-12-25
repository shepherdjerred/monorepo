import React from "https://esm.sh/react@18.2.0";
import { renderItems } from "./item.tsx";
import { palette } from "../assets/colors.ts";
// @deno-types="npm:@types/lodash"
import _ from "npm:lodash@4.17.21";
import { laneToString } from "@discord/data";
// import summoner from "../assets/summoner.json" assert { type: "json" };
import { Champion } from "@discord/data";
import { summoner } from "../../dataDragon/summoner.ts";

export function renderChampion(
  champion: Champion,
  highlight: boolean,
  durationInMinutes: number,
  damageMax: number
) {
  const items = renderItems(champion.items, champion.visionScore);
  const kdaRatio = _.round(
    (champion.kills + champion.assists) / champion.deaths,
    1
  );
  const lane = champion.lane ? laneToString(champion.lane) : "?";
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
        src={`https://ddragon.leagueoflegends.com/cdn/13.22.1/img/spell/${name}.png`}
        width="60"
        height="60"
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
      }}
    >
      <div style={{ display: "flex" }}>
        <span style={{ width: "20rem" }}>{lane}</span>
        <span style={{ fontWeight: 700, width: "10rem" }}>
          {champion.level}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          color: highlight ? palette.gold.bright : "",
          width: "50rem",
        }}
      >
        <span style={{ fontWeight: 700 }}>{champion.summonerName}</span>
        <span>{champion.championName}</span>
      </div>

      <div style={{ display: "flex", gap: "3rem" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>{summs}</div>
        <div style={{ display: "flex", flexDirection: "row" }}>{items}</div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: "30rem",
        }}
      >
        <span
          style={{ fontWeight: 700, color: highlight ? palette.gold[1] : "" }}
        >
          {`${champion.kills} / ${champion.deaths} / ${champion.assists}`}
        </span>
        <span>{kdaRatio} KDA</span>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "2rem",
          width: "40rem",
        }}
      >
        <div style={{ display: "flex", gap: "2rem", fontWeight: 700 }}>
          {champion.damage.toLocaleString()} dmg
        </div>
        <span
          style={{
            width: "20rem",
            height: "2rem",
            backgroundColor: palette.grey[1],
          }}
        >
          <span
            style={{
              width: `${damagePercent}%`,
              height: "100%",
              backgroundColor: highlight
                ? palette.gold.bright
                : palette.white[1],
            }}
          />
        </span>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: "30rem",
        }}
      >
        <span style={{ fontWeight: 700 }}>
          {champion.gold.toLocaleString()} gold
        </span>
        <span>
          {_.round(champion.gold / durationInMinutes).toLocaleString()} / min
        </span>
      </div>
    </div>
  );
}
