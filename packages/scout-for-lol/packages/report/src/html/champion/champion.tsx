import { renderItems } from "@scout-for-lol/report/html/champion/item.tsx";
import { palette } from "@scout-for-lol/report/assets/colors.ts";
import type { Champion } from "@scout-for-lol/data";
import { summoner } from "@scout-for-lol/data/index";
import { getSpellImage } from "@scout-for-lol/report/dataDragon/image-cache.ts";
import { CreepScore } from "@scout-for-lol/report/html/champion/creep-score.tsx";
import { Gold } from "@scout-for-lol/report/html/champion/gold.tsx";
import { Damage } from "@scout-for-lol/report/html/champion/damage.tsx";
import { Kda } from "@scout-for-lol/report/html/champion/kda.tsx";
import { Names } from "@scout-for-lol/report/html/champion/names.tsx";
import { Lane } from "@scout-for-lol/report/html/lane/index.tsx";
import { Runes } from "@scout-for-lol/report/html/champion/runes.tsx";
import { first, keys, map, pickBy, round } from "remeda";

// highlight should be true if this champion's riotIdGameName is in the highlightNames array (player-based highlight)
export function renderChampion(champion: Champion, highlight: boolean, durationInMinutes: number, damageMax: number) {
  const items = renderItems(champion.items, champion.visionScore, false);

  const damagePercent = round((champion.damage / damageMax || 0) * 100, 0);

  const summs = map(champion.spells, (spell) => {
    const name = first(keys(pickBy(summoner.data, (summoner) => summoner.key === spell.toString())));

    if (name === undefined) {
      throw new Error(`Summoner spell ${spell.toString()} not found`);
    }

    const spellData = summoner.data[name];
    if (!spellData) {
      throw new Error(`Summoner spell data not found for ${name}`);
    }

    const size = "3.75rem";

    return (
      <div style={{ width: size, height: size, display: "flex" }}>
        <img
          src={getSpellImage(spellData.image.full)}
          alt=""
          style={{
            backgroundColor: palette.blue[5],
            border: `.01rem solid ${palette.gold.bright}`,
            objectFit: "contain",
            width: "100%",
            height: "100%",
            display: "block",
          }}
        />
      </div>
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
        {champion.lane && <Lane lane={champion.lane} />}
        <span style={{ fontWeight: 700, width: "10rem" }}>{champion.level.toString()}</span>
      </div>

      <Names championName={champion.championName} summonerName={champion.riotIdGameName} highlight={highlight} />

      <div style={{ display: "flex", gap: "3rem" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>{summs}</div>
        <Runes runes={champion.runes} />
        <div style={{ display: "flex", flexDirection: "row" }}>{items}</div>
      </div>

      <Kda kills={champion.kills} deaths={champion.deaths} assists={champion.assists} highlight={highlight} />
      <Damage value={champion.damage} percent={damagePercent} highlight={highlight} />
      <Gold value={champion.gold} durationInMinutes={durationInMinutes} />
      <CreepScore value={champion.creepScore} durationInMinutes={durationInMinutes} />
    </div>
  );
}
