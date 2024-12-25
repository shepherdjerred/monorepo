import { palette } from "../../assets/colors.ts";
import React from "https://esm.sh/react@18.2.0";

export function Damage({
  value,
  percent,
  highlight,
}: {
  value: number;
  percent: number;
  highlight: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "2rem",
        width: "40rem",
      }}
    >
      <div style={{ display: "flex", gap: "2rem", fontWeight: 700 }}>
        {value.toLocaleString()} dmg
      </div>
      <span
        style={{
          width: "20rem",
          height: "1.5rem",
          backgroundColor: palette.grey[1],
        }}
      >
        <span
          style={{
            display: "flex",
            width: `${percent}%`,
            height: "100%",
            backgroundColor: highlight ? palette.gold.bright : palette.white[1],
          }}
        />
      </span>
    </div>
  );
}
