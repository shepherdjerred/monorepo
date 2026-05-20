import { palette } from "#src/assets/colors.ts";
import { font } from "#src/assets/index.ts";
import { round } from "remeda";

export function Damage({
  value,
  percent,
  highlight,
  teamSize,
}: {
  value: number;
  percent: number;
  highlight: boolean;
  teamSize: number;
}) {
  const sizeWord = teamSize === 2 ? "Duo" : "Trio";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        gap: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 6,
          color: highlight ? palette.gold.bright : palette.gold[1],
          fontFamily: font.title,
          fontWeight: 700,
        }}
      >
        <span style={{ fontSize: 22 }}>{value.toLocaleString()}</span>
        <span
          style={{
            fontSize: 12,
            color: palette.grey[1],
            letterSpacing: 2,
            textTransform: "uppercase",
          }}
        >
          dmg
        </span>
      </div>
      <div
        style={{
          width: "100%",
          height: 4,
          backgroundColor: palette.grey[3],
          display: "flex",
        }}
      >
        <div
          style={{
            width: `${percent.toString()}%`,
            height: 4,
            display: "flex",
            backgroundColor: highlight ? palette.gold.bright : palette.gold[3],
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 11,
          letterSpacing: 2,
          color: palette.grey[1],
          textTransform: "uppercase",
          fontFamily: font.body,
        }}
      >
        {round(percent, 0).toString()}% of {sizeWord}
      </div>
    </div>
  );
}
