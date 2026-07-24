import { divisionToString, leaguePointsDelta } from "@scout-for-lol/data";
import type { Rank } from "@scout-for-lol/data";
import { palette } from "#src/assets/colors.ts";
import { font } from "#src/assets/index.ts";

/**
 * Top-right pill showing "+22 LP DIAMOND II" style metadata. Used by both
 * ranked designs. When `oldRank` is omitted the LP delta is hidden.
 */
export function TierPill({
  oldRank,
  newRank,
  fontSizeRem = 4,
}: {
  oldRank: Rank | undefined;
  newRank: Rank;
  fontSizeRem?: number;
}) {
  const delta = oldRank ? leaguePointsDelta(oldRank, newRank) : undefined;
  const deltaText =
    delta === undefined
      ? undefined
      : `${delta >= 0 ? "+" : ""}${delta.toString()} LP`;
  const tierText = `${newRank.tier.toUpperCase()} ${divisionToString(newRank.division)}`;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: `${(fontSizeRem * 0.6).toString()}rem`,
        fontFamily: font.title,
      }}
    >
      {deltaText !== undefined && (
        <span
          style={{
            color: palette.blue[2],
            fontSize: `${fontSizeRem.toString()}rem`,
            fontWeight: 700,
            display: "flex",
          }}
        >
          {deltaText}
        </span>
      )}
      <span
        style={{
          color: palette.gold[1],
          fontSize: `${fontSizeRem.toString()}rem`,
          letterSpacing: "0.2rem",
          fontWeight: 500,
          display: "flex",
        }}
      >
        {tierText}
      </span>
    </div>
  );
}
