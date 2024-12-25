import React from "https://esm.sh/react@18.2.0";
import { Lane } from "@discord/data";
import { encodeBase64 } from "https://deno.land/std@0.218.2/encoding/base64.ts";

const images: Record<Lane | "unknown", string> = {
  top: encodeBase64(
    (await Deno.readFile(new URL("assets/top.png", import.meta.url))).toString()
  ).toString(),
  jungle: encodeBase64(
    (
      await Deno.readFile(new URL("assets/jungle.png", import.meta.url))
    ).toString()
  ).toString(),
  middle: encodeBase64(
    (
      await Deno.readFile(new URL("assets/middle.png", import.meta.url))
    ).toString()
  ).toString(),
  adc: encodeBase64(
    (
      await Deno.readFile(new URL("assets/bottom.png", import.meta.url))
    ).toString()
  ).toString(),
  support: encodeBase64(
    (
      await Deno.readFile(new URL("assets/support.png", import.meta.url))
    ).toString()
  ).toString(),
  unknown: encodeBase64(
    (
      await Deno.readFile(new URL("assets/unknown.png", import.meta.url))
    ).toString()
  ).toString(),
};

export function Lane({ lane }: { lane: Lane | undefined }) {
  return (
    <span style={{ width: "20rem", display: "flex", justifyContent: "center" }}>
      <img
        src={`data:image/png;base64,${images[lane || "unknown"]}`}
        style={{ width: "8rem" }}
      />
    </span>
  );
}
