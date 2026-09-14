import { round } from "remeda";
import { computeKda } from "@scout-for-lol/data";
import { Stat } from "#src/html/champion/shared/stat.tsx";

// TODO(https://github.com/shepherdjerred/monorepo/issues/183): Add K/D/A icon for better visual hierarchy
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
  const kdaRatio = round(computeKda({ kills, deaths, assists }), 2);
  const mainValue = `${kills.toString()} / ${deaths.toString()} / ${assists.toString()}`;

  return (
    <Stat
      mainValue={mainValue}
      rateValue={kdaRatio}
      rateLabel="KDA"
      highlight={highlight}
      ratePrecision={2}
    />
  );
}
