import { getChampionImage } from "#src/dataDragon/image-cache.ts";
import { palette } from "#src/assets/colors.ts";
import { font } from "#src/assets/index.ts";
import { GradeDiamond } from "#src/html/shared/grade-diamond.tsx";
import {
  computeKda,
  gradeFromKda,
  type Grade,
} from "#src/html/shared/grade.ts";
import type { CompletedMatch } from "@scout-for-lol/data";

export function SquadRow({
  player,
  isMvp,
  compact = false,
}: {
  player: CompletedMatch["players"][number];
  isMvp: boolean;
  compact?: boolean;
}) {
  const { kills, deaths, assists, championName, riotIdGameName } =
    player.champion;
  const kda = computeKda(kills, deaths, assists);
  const grade: Grade = gradeFromKda(kda);
  const icon = getChampionImage(championName);
  const won = player.outcome === "Victory";
  const iconRem = compact ? 5 : 7;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: compact ? "1.2rem" : "3rem",
        padding: compact ? "0.8rem 1.2rem" : "1.5rem 2.5rem",
        background: "rgba(1, 10, 19, 0.55)",
        border: `0.2rem solid ${palette.gold[5]}`,
        borderRadius: "1rem",
        width: "100%",
      }}
    >
      <div
        style={{
          width: `${iconRem.toString()}rem`,
          height: `${iconRem.toString()}rem`,
          display: "flex",
          flexShrink: 0,
          overflow: "hidden",
          borderRadius: "0.5rem",
          border: `0.15rem solid ${palette.gold[4]}`,
        }}
      >
        <img
          src={icon}
          alt=""
          width={iconRem * 16}
          height={iconRem * 16}
          style={{ width: "100%", height: "100%", display: "block" }}
        />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          fontFamily: font.title,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: compact ? "0.8rem" : "1.5rem",
          }}
        >
          <span
            style={{
              fontSize: compact ? "2.4rem" : "3.4rem",
              color: palette.gold[1],
              fontWeight: 600,
              display: "flex",
            }}
          >
            {riotIdGameName}
          </span>
          {isMvp && (
            <span
              style={{
                fontSize: compact ? "1.3rem" : "1.8rem",
                color: palette.blue[2],
                background: "rgba(10, 200, 185, 0.15)",
                border: `0.15rem solid ${palette.blue[2]}`,
                padding: "0.2rem 0.8rem",
                borderRadius: "0.3rem",
                letterSpacing: "0.15rem",
                fontWeight: 700,
                display: "flex",
              }}
            >
              MVP
            </span>
          )}
        </div>
        <span
          style={{
            fontSize: compact ? "1.5rem" : "2rem",
            color: palette.grey[1],
            fontFamily: font.body,
            display: "flex",
          }}
        >
          {championName} · {won ? "W" : "L"}
        </span>
      </div>
      <span
        style={{
          fontSize: compact ? "2.4rem" : "3.4rem",
          color: palette.gold[1],
          fontFamily: font.title,
          letterSpacing: "0.15rem",
          display: "flex",
        }}
      >
        {kills} / {deaths} / {assists}
      </span>
      <GradeDiamond grade={grade} size={compact ? 4.8 : 6} />
    </div>
  );
}
