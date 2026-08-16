import { type ArenaMatch } from "@scout-for-lol/data";
import { palette } from "@scout-for-lol/design-system/satori/colors";
import { font } from "@scout-for-lol/design-system/satori/fonts";
import { formatDuration } from "#src/html/arena/utils.ts";

export function PageHeader({ match }: { match: ArenaMatch }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: 24,
        width: "100%",
        fontSize: 20,
        color: palette.grey[1],
        fontFamily: font.body,
        textTransform: "uppercase",
        letterSpacing: 4,
      }}
    >
      <span
        style={{
          color: palette.gold[3],
          fontFamily: font.title,
          fontWeight: 500,
          letterSpacing: 10,
        }}
      >
        Arena
      </span>
      <span>{formatDuration(match.durationInSeconds)}</span>
    </div>
  );
}
