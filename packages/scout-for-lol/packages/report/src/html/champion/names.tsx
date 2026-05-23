import { palette } from "#src/assets/colors.ts";
import { getChampionImage } from "#src/dataDragon/image-cache.ts";

export function Names({
  summonerName,
  championName,
  highlight,
}: {
  summonerName: string;
  championName: string;
  highlight: boolean;
}) {
  const championIcon = getChampionImage(championName);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: "2rem",
        color: highlight ? palette.gold.bright : "",
        width: "50rem",
      }}
    >
      <img
        src={championIcon}
        alt=""
        width="72"
        height="72"
        style={{
          width: "7rem",
          height: "7rem",
          borderRadius: "50%",
          border: `0.25rem solid ${
            highlight ? palette.gold.bright : palette.gold[5]
          }`,
          objectFit: "cover",
          flexShrink: 0,
        }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontWeight: 700,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: "40rem",
          }}
        >
          {summonerName}
        </span>
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: "40rem",
          }}
        >
          {championName}
        </span>
      </div>
    </div>
  );
}
