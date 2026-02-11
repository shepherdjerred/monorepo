import { type ArenaChampion } from "@shepherdjerred/scout-data";
import { ChampionInfo } from "@shepherdjerred/scout-report/html/arena/champion-info.tsx";
import { AugmentsDisplay } from "@shepherdjerred/scout-report/html/arena/augments-display.tsx";
import { round } from "remeda";

export function PlayerCard({
  player,
  highlight,
  maxTeamDamage,
}: {
  player: ArenaChampion;
  highlight: boolean;
  maxTeamDamage: number;
}) {
  const damagePercent = round((player.damage / (maxTeamDamage || 1)) * 100, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", marginBottom: 16, gap: 8 }}>
      <ChampionInfo
        items={player.items}
        playerName={player.riotIdGameName}
        championName={player.championName}
        kills={player.kills}
        deaths={player.deaths}
        assists={player.assists}
        damage={player.damage}
        damagePercent={damagePercent}
        highlight={highlight}
      />

      <AugmentsDisplay augments={player.augments} />
    </div>
  );
}
