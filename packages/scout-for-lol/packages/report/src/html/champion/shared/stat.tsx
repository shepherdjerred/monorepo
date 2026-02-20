import { round } from "remeda";
import { palette } from "@scout-for-lol/report/assets/colors.ts";

type StatProps = {
  mainValue: string;
  rateValue: number;
  rateLabel: string;
  highlight?: boolean;
  ratePrecision?: number;
};

/**
 * Generic stat component for displaying a main value and a calculated rate
 * Used by KDA, Gold, and CreepScore components
 */
export function Stat({
  mainValue,
  rateValue,
  rateLabel,
  highlight,
  ratePrecision = 2,
}: StatProps) {
  const formattedRate =
    ratePrecision === 0
      ? round(rateValue, 0).toLocaleString()
      : round(rateValue, ratePrecision).toLocaleString();

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
        style={{
          fontWeight: 700,
          color: highlight === true ? palette.gold[1] : "",
        }}
      >
        {mainValue}
      </span>
      <span>
        {formattedRate} {rateLabel}
      </span>
    </div>
  );
}
