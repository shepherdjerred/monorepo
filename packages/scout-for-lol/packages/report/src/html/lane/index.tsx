import { type Lane, LaneSchema, getLaneIconBase64 } from "@scout-for-lol/data";
import { z } from "zod";

let images: Record<Lane, string>;

if (typeof Bun !== "undefined") {
  images = z.record(LaneSchema, z.string()).parse(
    Object.fromEntries(
      await Promise.all(
        LaneSchema.options.map(async (lane): Promise<[Lane, string]> => {
          const base64 = await getLaneIconBase64(lane);
          return [lane, base64];
        }),
      ),
    ),
  );
}

export function Lane({ lane }: { lane: Lane }) {
  const environment = typeof Bun === "undefined" ? "browser" : "bun";
  const image =
    environment === "bun"
      ? images[lane]
      : new URL(`assets/${lane}.png`, import.meta.url).href;
  return (
    <span style={{ width: "20rem", display: "flex", justifyContent: "center" }}>
      <div style={{ width: "8rem", height: "8rem", display: "flex" }}>
        <img
          src={image}
          alt=""
          style={{ width: "100%", height: "100%", display: "block" }}
        />
      </div>
    </span>
  );
}
