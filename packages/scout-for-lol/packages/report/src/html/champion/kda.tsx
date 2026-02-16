import { round } from "remeda";
import { Stat } from "@scout-for-lol/report/html/champion/shared/stat.tsx";

// TODO(https://github.com/shepherdjerred/scout-for-lol/issues/183): Add K/D/A icon for better visual hierarchy
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
  const kdaRatio = deaths === 0 ? kills + assists : round((kills + assists) / deaths, 2);
  const mainValue = `${kills.toString()} / ${deaths.toString()} / ${assists.toString()}`;

  return <Stat mainValue={mainValue} rateValue={kdaRatio} rateLabel="KDA" highlight={highlight} ratePrecision={2} />;
}
