import { type ArenaPlacement } from "@scout-for-lol/data";
import { palette } from "#src/assets/colors.ts";
import { font } from "#src/assets/index.ts";

const SIZE = 90;

export function PlacementBadge({ placement }: { placement: ArenaPlacement }) {
  return (
    <div
      style={{
        width: SIZE,
        height: SIZE,
        display: "flex",
        position: "relative",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: SIZE,
          height: SIZE,
          display: "flex",
          transform: "rotate(45deg)",
          background: `linear-gradient(135deg, ${palette.gold.gradient.end} 0%, ${palette.gold.gradient.start} 100%)`,
          border: `2px solid ${palette.gold[4]}`,
        }}
      />
      <span
        style={{
          position: "relative",
          fontSize: 40,
          fontWeight: 700,
          fontFamily: font.title,
          color: palette.blue[7],
        }}
      >
        {placement.toString()}
      </span>
    </div>
  );
}
