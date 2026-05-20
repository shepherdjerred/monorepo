import { type ArenaChampion } from "@scout-for-lol/data";
import { palette } from "#src/assets/colors.ts";
import { font } from "#src/assets/index.ts";
import { getChampionLoadingImage } from "#src/dataDragon/image-cache.ts";
import { Damage } from "#src/html/arena/damage.tsx";
import { ItemsRow } from "#src/html/arena/items-row.tsx";
import { AugmentsDisplay } from "#src/html/arena/augments-display.tsx";
import { ARENA_DEFAULT_SKIN_NUM } from "#src/html/arena/utils.ts";
import { round } from "remeda";

const SPLASH_HEIGHT = 320;

export function PlayerColumn({
  player,
  highlight,
  maxTeamDamage,
  teamSize,
}: {
  player: ArenaChampion;
  highlight: boolean;
  maxTeamDamage: number;
  teamSize: number;
}) {
  const damagePercent = round((player.damage / (maxTeamDamage || 1)) * 100, 0);
  const splash = getChampionLoadingImage(
    player.championName,
    ARENA_DEFAULT_SKIN_NUM,
  );

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minWidth: 0,
      }}
    >
      <div
        style={{
          width: "100%",
          height: SPLASH_HEIGHT,
          display: "flex",
          position: "relative",
          overflow: "hidden",
          border: highlight
            ? `2px solid ${palette.gold.bright}`
            : `1px solid rgba(120, 90, 40, 0.35)`,
        }}
      >
        <img
          src={splash}
          alt=""
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "center top",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            display: "flex",
            height: 36,
            background: "linear-gradient(transparent, rgba(0, 0, 0, 0.85) 60%)",
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          fontFamily: font.title,
          fontSize: 20,
          fontWeight: 700,
          color: highlight ? palette.gold.bright : palette.grey[1],
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: "100%",
        }}
      >
        {player.riotIdGameName}
      </div>

      <div
        style={{
          display: "flex",
          fontFamily: font.body,
          fontSize: 11,
          letterSpacing: 3,
          color: palette.grey[1],
          textTransform: "uppercase",
        }}
      >
        {player.championName}
      </div>

      <div
        style={{
          height: 1,
          width: "100%",
          display: "flex",
          background: palette.gold[5],
          opacity: highlight ? 0.7 : 0.25,
          marginTop: 4,
          marginBottom: 4,
        }}
      />

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          fontFamily: font.title,
          fontSize: 26,
          fontWeight: 700,
          color: palette.white[1],
        }}
      >
        <span>{player.kills.toString()}</span>
        <span style={{ color: palette.grey[1] }}>/</span>
        <span>{player.deaths.toString()}</span>
        <span style={{ color: palette.grey[1] }}>/</span>
        <span>{player.assists.toString()}</span>
      </div>

      <div
        style={{
          display: "flex",
          fontFamily: font.body,
          fontSize: 11,
          letterSpacing: 2,
          color: palette.grey[1],
          textTransform: "uppercase",
        }}
      >
        {kdaRatio(player.kills, player.deaths, player.assists)} KDA
      </div>

      <Damage
        value={player.damage}
        percent={damagePercent}
        highlight={highlight}
        teamSize={teamSize}
      />

      <ItemsRow items={player.items} />

      <AugmentsDisplay augments={player.augments} />
    </div>
  );
}

function kdaRatio(kills: number, deaths: number, assists: number): string {
  if (deaths === 0) {
    return "Perfect";
  }
  return ((kills + assists) / deaths).toFixed(2);
}
