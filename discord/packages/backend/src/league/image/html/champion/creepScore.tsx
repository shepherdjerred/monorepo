// @deno-types="npm:@types/lodash"
import _ from "npm:lodash@4.17.21";
import React from "https://esm.sh/react@18.2.0";

export function CreepScore({
  value,
  durationInMinutes,
}: {
  value: number;
  durationInMinutes: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width: "30rem",
      }}
    >
      <span style={{ fontWeight: 700 }}>{value.toLocaleString()} CS</span>
      <span>
        {_.round(value / durationInMinutes, 2).toLocaleString()} / min
      </span>
    </div>
  );
}
