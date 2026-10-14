import type { RuntimeMediaFormat } from "@arcade/common/runtime/config.ts";
import type { GameId } from "@arcade/common/catalog.ts";

export type NativeGameId = Extract<GameId, "mkwii" | "melee" | "brawl">;
export const nativeFormats: Record<NativeGameId, RuntimeMediaFormat> = {
  mkwii: {
    width: 853,
    height: 480,
    fps: 30,
    pixelFormat: "rgba",
    audioSampleRate: 48_000,
    audioChannels: 2,
    displayAspect: 16 / 9,
  },
  melee: {
    width: 960,
    height: 720,
    fps: 30,
    pixelFormat: "rgba",
    audioSampleRate: 48_000,
    audioChannels: 2,
    displayAspect: 4 / 3,
  },
  brawl: {
    width: 640,
    height: 480,
    fps: 30,
    pixelFormat: "rgba",
    audioSampleRate: 48_000,
    audioChannels: 2,
    displayAspect: 4 / 3,
  },
};
