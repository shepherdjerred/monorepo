import { getChampionImage } from "@scout-for-lol/report/dataDragon/image-cache.ts";
import { renderItems } from "@scout-for-lol/report/html/champion/item.tsx";
import { Damage } from "@scout-for-lol/report/html/arena/damage.tsx";

export function ChampionInfo({
  playerName,
  championName,
  kills,
  deaths,
  assists,
  items,
  damage,
  damagePercent,
  highlight,
}: {
  playerName: string;
  championName: string;
  kills: number;
  deaths: number;
  assists: number;
  items: number[];
  damage: number;
  damagePercent: number;
  highlight: boolean;
}) {
  const actualItems = renderItems(items, 0, true);

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 16,
        marginBottom: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
        <img
          src={getChampionImage(championName)}
          style={{
            width: 60,
            height: 60,
            borderRadius: 8,
            border: highlight ? "3px solid #fbbf24" : "2px solid #374151",
            flexShrink: 0,
          }}
          alt={championName}
        />
        <div
          style={{
            display: "flex",
            fontSize: 24,
            opacity: 0.9,
            justifyContent: "center",
            gap: 0,
            flexDirection: "column",
          }}
        >
          <span style={{ color: highlight ? "#fbbf24" : "" }}>
            {playerName}
          </span>
          <span style={{ color: highlight ? "#fbbf24" : "" }}>
            {championName}
          </span>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transform: "scale(0.5)",
          transformOrigin: "center",
        }}
      >
        {actualItems}
      </div>

      <Damage value={damage} percent={damagePercent} highlight={highlight} />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 24,
          fontWeight: 600,
          color: kills > deaths ? "#10b981" : "#ef4444",
          minWidth: 80,
        }}
      >
        {kills}/{deaths}/{assists}
      </div>
    </div>
  );
}
