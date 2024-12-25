// @deno-types="npm:@types/lodash"
import _ from "npm:lodash@4.17.21";
import { palette } from "../../assets/colors.ts";
import React from "https://esm.sh/react@18.2.0";

export function Kda({
  kills,
  deaths,
  assists,
  highlight,
}: {
  kills: number;
  deaths: number;
  assists: number;
  highlight: boolean;
}) {
  const kdaRatio = deaths === 0
    ? kills + deaths
    : _.round((kills + assists) / deaths, 1);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width: "30rem",
      }}
    >
      <span
        style={{ fontWeight: 700, color: highlight ? palette.gold[1] : "" }}
      >
        {`${kills} / ${deaths} / ${assists}`}
      </span>
      <span>{kdaRatio} KDA</span>
    </div>
  );
}
