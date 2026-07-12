import {
  championNameToDisplayName,
  type ArenaChampion,
} from "@scout-for-lol/data";
import { palette } from "#src/assets/colors.ts";
import { font } from "#src/assets/index.ts";
import { getChampionLoadingImage } from "#src/dataDragon/image-cache.ts";
import { Damage } from "#src/html/arena/damage.tsx";
import { ItemsRow } from "#src/html/arena/items-row.tsx";
import { AugmentsDisplay } from "#src/html/arena/augments-display.tsx";
import { ARENA_DEFAULT_SKIN_NUM } from "#src/html/arena/utils.ts";
import { round } from "remeda";

const SPLASH_HEIGHT = 320;
const TRACKED_WEIGHT = 1.12;

export function getDamageSharePercent(damage: number, totalDamage: number) {
  if (totalDamage === 0) {
    return 0;
  }

  return round((damage / totalDamage) * 100, 0);
}

export function PlayerColumn({
  player,
  highlight,
  isFirst,
  isLast,
  maxTeamDamage,
  totalTeamDamage,
  teamSize,
}: {
  player: ArenaChampion;
  highlight: boolean;
  isFirst: boolean;
  isLast: boolean;
  maxTeamDamage: number;
  totalTeamDamage: number;
  teamSize: number;
}) {
  const damagePercent = round((player.damage / (maxTeamDamage || 1)) * 100, 0);
  const teamDamagePercent = getDamageSharePercent(
    player.damage,
    totalTeamDamage,
  );
  const splash = getChampionLoadingImage(
    player.championName,
    ARENA_DEFAULT_SKIN_NUM,
  );

  return (
    <div
      style={{
        flexGrow: highlight ? TRACKED_WEIGHT : 1,
        flexShrink: 1,
        flexBasis: 0,
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        borderLeft: isFirst ? `1px solid ${palette.gold[6]}` : "none",
        borderRight: isLast
          ? `1px solid ${palette.gold[6]}`
          : `1px solid rgba(120, 90, 40, 0.55)`,
        borderBottom: `1px solid ${palette.gold[6]}`,
        backgroundColor: highlight
          ? "rgba(200, 170, 110, 0.06)"
          : "rgba(5, 10, 20, 0.08)",
      }}
    >
      <div
        style={{
          width: "100%",
          height: SPLASH_HEIGHT,
          display: "flex",
          position: "relative",
          overflow: "hidden",
          borderTop: highlight
            ? `2px solid ${palette.gold.bright}`
            : `1px solid rgba(120, 90, 40, 0.45)`,
          borderBottom: `1px solid ${palette.gold[5]}`,
          borderLeft: highlight ? `2px solid ${palette.gold.bright}` : "none",
          borderRight: highlight ? `2px solid ${palette.gold.bright}` : "none",
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
            height: 110,
            background:
              "linear-gradient(transparent, rgba(0, 0, 0, 0.9) 66%, rgba(0, 0, 0, 0.98))",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: 12,
            left: 10,
            right: 10,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
          }}
        >
          <div
            style={{
              display: "flex",
              fontFamily: font.title,
              fontSize: 16,
              fontWeight: 700,
              lineHeight: 1,
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
              fontSize: 10,
              lineHeight: 1,
              letterSpacing: 4,
              color: highlight ? palette.gold[1] : palette.grey[2],
              textTransform: "uppercase",
            }}
          >
            {championNameToDisplayName(player.championName)}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          gap: 8,
          padding: "18px 14px 16px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "baseline",
            gap: 7,
            fontFamily: font.title,
            fontSize: 24,
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
            justifyContent: "center",
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
          teamPercent={teamDamagePercent}
          highlight={highlight}
          teamSize={teamSize}
        />

        <ItemsRow items={player.items} />

        <AugmentsDisplay augments={player.augments} />
      </div>
    </div>
  );
}

function kdaRatio(kills: number, deaths: number, assists: number): string {
  if (deaths === 0) {
    return "Perfect";
  }
  return ((kills + assists) / deaths).toFixed(2);
}
