import {
  divisionToString,
  TierSchema,
  wasDemoted,
  wasPromoted,
} from "@scout-for-lol/data";
import type { Rank, Tier } from "@scout-for-lol/data";
import { palette } from "@scout-for-lol/report/assets/colors.ts";
import { z } from "zod";
import { match } from "ts-pattern";

// in a Node.js environment, we want to grab these from the file system
let images: Record<Tier, string>;

if (typeof Bun !== "undefined") {
  images = z.record(TierSchema, z.string()).parse(
    Object.fromEntries(
      await Promise.all(
        TierSchema.options.map(async (tier): Promise<[Tier, string]> => {
          const image = await Bun.file(
            new URL(
              `assets/Rank=${tier.charAt(0).toUpperCase() + tier.slice(1)}.png`,
              import.meta.url,
            ),
          ).arrayBuffer();
          const bytes = new Uint8Array(image);
          // Use Buffer to avoid stack overflow with large arrays
          return [tier, Buffer.from(bytes).toString("base64")];
        }),
      ),
    ),
  );
}

export function RankedBadge({
  oldRank,
  newRank,
  scale = 1,
}: {
  oldRank: Rank | undefined;
  newRank: Rank;
  scale?: number;
}) {
  const environment = typeof Bun === "undefined" ? "browser" : "bun";

  // Use the pre-loaded images in Bun environment, or construct a URL for browser
  const badge = match(environment)
    .with("bun", () => `data:image/png;base64,${images[newRank.tier]}`)
    .with("browser", () => {
      // Construct the import path for Vite to handle at build time
      return new URL(
        `assets/Rank=${newRank.tier.charAt(0).toUpperCase() + newRank.tier.slice(1)}.png`,
        import.meta.url,
      ).href;
    })
    .exhaustive();

  const showPromoted = wasPromoted(oldRank, newRank);
  const showDemoted = wasDemoted(oldRank, newRank);

  // Scale all dimensions proportionally
  const iconSize = 24 * scale;
  const fontSize = 6 * scale;
  const divisionLeftOffset = -8 * scale;
  const divisionTopOffset = -2 * scale;
  const promotedTextTop = 22 * scale;
  const gap = 2 * scale;
  const topOffset = -20 * scale;
  const rightOffset = 2 * scale;

  const outerStyle =
    scale === 1
      ? {
          color: palette.gold[1],
          fontSize: `${fontSize.toString()}rem`,
          display: "flex" as const,
          alignItems: "flex-end" as const,
          gap: "4rem",
          position: "absolute" as const,
          right: `${rightOffset.toString()}rem`,
          top: `${topOffset.toString()}rem`,
        }
      : {
          color: palette.gold[1],
          fontSize: `${fontSize.toString()}rem`,
          display: "flex" as const,
          alignItems: "flex-end" as const,
          gap: "4rem",
          position: "relative" as const,
        };

  return (
    <div
      style={{
        display: "flex",
        position: "relative",
      }}
    >
      <div style={outerStyle}>
        <div
          style={{
            display: "flex",
            flexDirection: "column-reverse",
            alignItems: "stretch",
            gap: `${gap.toString()}rem`,
          }}
        >
          <span
            style={{
              position: "relative",
              display: "flex",
              alignItems: "flex-end",
            }}
          >
            <div
              style={{
                width: `${iconSize.toString()}rem`,
                height: `${iconSize.toString()}rem`,
                display: "flex",
              }}
            >
              <img
                src={badge}
                alt=""
                style={{ width: "100%", height: "100%", display: "block" }}
              />
            </div>
            <span
              style={{
                position: "relative",
                left: `${divisionLeftOffset.toString()}rem`,
                top: `${divisionTopOffset.toString()}rem`,
              }}
            >
              {divisionToString(newRank.division)}
            </span>
          </span>
          <span
            style={{
              position: "absolute",
              top: `${promotedTextTop.toString()}rem`,
            }}
          >
            {showPromoted && `Promoted`}
            {showDemoted && `Demoted`}
          </span>
        </div>
      </div>
    </div>
  );
}
