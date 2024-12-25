import React from "https://esm.sh/react@18.2.0";
import "https://esm.sh/react@18.2.0";
import {
  divisionToString,
  Rank,
  Tier,
  wasDemoted,
  wasPromoted,
} from "@discord/data";
// @deno-types="npm:@types/lodash"
import _ from "npm:lodash@4.17.21";
import { palette } from "../../assets/colors.ts";
import { encodeBase64 } from "https://deno.land/std@0.218.2/encoding/base64.ts";

const images: Record<Tier, string> = {
  iron: encodeBase64(
    (
      await Deno.readFile(new URL("assets/Rank=Iron.png", import.meta.url))
    ).toString()
  ).toString(),
  bronze: encodeBase64(
    (
      await Deno.readFile(new URL("assets/Rank=Bronze.png", import.meta.url))
    ).toString()
  ).toString(),
  silver: encodeBase64(
    (
      await Deno.readFile(new URL("assets/Rank=Silver.png", import.meta.url))
    ).toString()
  ).toString(),
  gold: encodeBase64(
    (
      await Deno.readFile(new URL("assets/Rank=Gold.png", import.meta.url))
    ).toString()
  ).toString(),

  platinum: encodeBase64(
    (
      await Deno.readFile(new URL("assets/Rank=Platinum.png", import.meta.url))
    ).toString()
  ).toString(),
  emerald: encodeBase64(
    (
      await Deno.readFile(new URL("assets/Rank=Emerald.png", import.meta.url))
    ).toString()
  ).toString(),
  diamond: encodeBase64(
    (
      await Deno.readFile(new URL("assets/Rank=Diamond.png", import.meta.url))
    ).toString()
  ).toString(),
  master: encodeBase64(
    (
      await Deno.readFile(new URL("assets/Rank=Master.png", import.meta.url))
    ).toString()
  ).toString(),
  grandmaster: encodeBase64(
    (
      await Deno.readFile(
        new URL("assets/Rank=Grandmaster.png", import.meta.url)
      )
    ).toString()
  ).toString(),
  challenger: encodeBase64(
    (
      await Deno.readFile(
        new URL("assets/Rank=Challenger.png", import.meta.url)
      )
    ).toString()
  ).toString(),
};

export function RankedBadge({
  oldRank,
  newRank,
}: {
  oldRank: Rank | undefined;
  newRank: Rank;
}) {
  const badge = images[newRank.tier];
  const showPromoted = wasPromoted(oldRank, newRank);
  const showDemoted = wasDemoted(oldRank, newRank);
  return (
    <div
      style={{
        display: "flex",
        position: "relative",
      }}
    >
      <div
        style={{
          color: palette.gold[1],
          fontSize: "6rem",
          display: "flex",
          alignItems: "flex-end",
          gap: "4rem",
          position: "absolute",
          right: "2rem",
          top: "-20rem",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column-reverse",
            alignItems: "stretch",
            gap: "2rem",
          }}
        >
          <span
            style={{
              position: "relative",
              display: "flex",
              alignItems: "flex-end",
            }}
          >
            <img
              src={`data:image/png;base64,${badge}`}
              style={{ width: "24rem" }}
            />
            <span style={{ position: "relative", left: "-8rem", top: "-2rem" }}>
              {divisionToString(newRank.division)}
            </span>
          </span>
          <span style={{ position: "absolute", top: "22rem" }}>
            {showPromoted && `Promoted`}
            {showDemoted && `Demoted`}
          </span>
        </div>
      </div>
    </div>
  );
}
