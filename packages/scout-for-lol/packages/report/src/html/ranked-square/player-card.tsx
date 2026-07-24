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

const ICON_REM = 11;

export function PlayerCard({
  player,
  isMvp,
  width,
}: {
  player: CompletedMatch["players"][number];
  isMvp: boolean;
  width: string;
}) {
  const { kills, deaths, assists, championName, riotIdGameName } =
    player.champion;
  const kda = computeKda(kills, deaths, assists);
  const grade: Grade = gradeFromKda(kda);
  const icon = getChampionImage(championName);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "1.5rem",
        padding: "3rem 2rem",
        background: "rgba(1, 10, 19, 0.6)",
        border: `0.25rem solid ${palette.gold[5]}`,
        borderRadius: "1.5rem",
        width,
        fontFamily: font.title,
      }}
    >
      <div
        style={{
          width: `${ICON_REM.toString()}rem`,
          height: `${ICON_REM.toString()}rem`,
          display: "flex",
          overflow: "hidden",
          borderRadius: "0.6rem",
          border: `0.2rem solid ${palette.gold[4]}`,
          flexShrink: 0,
        }}
      >
        <img
          src={icon}
          alt=""
          width={ICON_REM * 16}
          height={ICON_REM * 16}
          style={{ width: "100%", height: "100%", display: "block" }}
        />
      </div>
      <span
        style={{
          fontSize: "3rem",
          color: palette.gold[1],
          fontWeight: 500,
          display: "flex",
        }}
      >
        {riotIdGameName}
      </span>
      <span
        style={{
          fontSize: "5rem",
          color: palette.gold[4],
          fontFamily: font.title,
          fontStyle: "italic",
          display: "flex",
          lineHeight: 1,
        }}
      >
        {kills}/{deaths}/{assists}
      </span>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1.5rem",
        }}
      >
        <span
          style={{
            fontSize: "2.2rem",
            color: palette.grey[1],
            fontFamily: font.body,
            display: "flex",
          }}
        >
          {kda.toFixed(2)}
        </span>
        <GradeDiamond grade={grade} size={6} />
      </div>
      {isMvp && (
        <span
          style={{
            fontSize: "2rem",
            color: palette.blue[2],
            background: "rgba(10, 200, 185, 0.15)",
            border: `0.2rem solid ${palette.blue[2]}`,
            padding: "0.4rem 1.4rem",
            borderRadius: "0.4rem",
            letterSpacing: "0.3rem",
            fontWeight: 700,
            display: "flex",
          }}
        >
          MVP
        </span>
      )}
    </div>
  );
}
