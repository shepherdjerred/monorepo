import { type Lane, LaneSchema } from "@shepherdjerred/scout-data";
import { z } from "zod";
import { match } from "ts-pattern";

let images: Record<Lane, string>;

if (typeof Bun !== "undefined") {
  images = z.record(LaneSchema, z.string()).parse(
    Object.fromEntries(
      await Promise.all(
        LaneSchema.options.map(async (lane): Promise<[Lane, string]> => {
          const image = await Bun.file(new URL(`./assets/${lane}.svg`, import.meta.url)).arrayBuffer();
          const bytes = new Uint8Array(image);
          // Use Buffer to avoid stack overflow with large arrays
          return [lane, Buffer.from(bytes).toString("base64")];
        }),
      ),
    ),
  );
}

export function Lane({ lane }: { lane: Lane }) {
  const environment = typeof Bun !== "undefined" ? "bun" : "browser";
  const image = match(environment)
    .with("bun", () => `data:image/svg+xml;base64,${images[lane]}`)
    .with("browser", () => {
      // Construct the URL for Vite to handle at build time
      return new URL(`./assets/${lane}.svg`, import.meta.url).href;
    })
    .exhaustive();
  return (
    <span style={{ width: "20rem", display: "flex", justifyContent: "center" }}>
      <div style={{ width: "8rem", height: "8rem", display: "flex" }}>
        <img src={image} alt="" style={{ width: "100%", height: "100%", display: "block" }} />
      </div>
    </span>
  );
}
