// @deno-types="npm:@types/lodash"
import _ from "npm:lodash@4.17.21";
import "https://esm.sh/react@18.2.0";
import { palette } from "../../assets/colors.ts";
import { latestVersion } from "../../../dataDragon/version.ts";
import React from "https://esm.sh/react@18.2.0";

const dimension = 120;

export function renderItem(item: number) {
  if (item !== 0) {
    return (
      <img
        src={`https://ddragon.leagueoflegends.com/cdn/${latestVersion}/img/item/${item.toString()}.png`}
        style={{
          backgroundColor: palette.blue[5],
          border: `1px solid ${palette.gold.bright}`,
        }}
        width={dimension}
        height={dimension}
      />
    );
  } else {
    return (
      <span
        style={{
          width: dimension,
          height: dimension,
          backgroundColor: palette.blue[5],
          border: `1px solid ${palette.gold.bright}`,
        }}
      />
    );
  }
}

export function renderItems(items: number[], visionScore: number) {
  if (items.length !== 7) {
    throw new Error(`Items must be length 7: ${items.toString()}`);
  }

  const mainItems = _.chain(items).take(6).map(renderItem).value();

  const lastItem = _.last(items);
  if (lastItem === undefined) {
    throw new Error(`Last item must exist: ${items.toString()}`);
  }
  const visionItem = (
    <div
      style={{
        display: "flex",
        position: "relative",
        width: `${dimension}px`,
        height: `${dimension}px`,
      }}
    >
      {renderItem(lastItem)}
      <span
        style={{
          position: "absolute",
          color: palette.white[1],
          textShadow: "8px 8px #000",
          bottom: "-10px",
          right: "5px",
          fontWeight: 700,
          stroke: "#000",
          strokeWidth: "100px",
        }}
      >
        {visionScore}
      </span>
    </div>
  );

  return (
    <div style={{ display: "flex", gap: "1rem" }}>
      {mainItems}
      {visionItem}
    </div>
  );
}
