import { palette } from "@scout-for-lol/report/assets/colors.ts";

// TODO(https://github.com/shepherdjerred/scout-for-lol/issues/182): Add champion icon to improve visual identification
export function Names({
  summonerName,
  championName,
  highlight,
}: {
  summonerName: string;
  championName: string;
  highlight: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        color: highlight ? palette.gold.bright : "",
        width: "50rem",
      }}
    >
      <span style={{ fontWeight: 700 }}>{summonerName}</span>
      <span>{championName}</span>
    </div>
  );
}
