import { z } from "zod";
import wire from "#client-duel-clock-wire";
import duel from "#learning-wire";

const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const seed = z
  .number()
  .int()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
const Expected = z.strictObject({
  seed,
  side: z.enum(wire.sides),
  mode: z.enum(wire.modes),
  opponent: z.enum(wire.opponents),
});
export const DuelClockMarker = z.strictObject({
  match: z
    .uuid()
    .refine((value) => value !== "00000000-0000-0000-0000-000000000000"),
  ...Expected.shape,
  sequence: z
    .number()
    .int()
    .min(0)
    .max(wire.maximumElapsed + 2),
  marker: z.enum(wire.markers),
  tick: integer.or(z.literal(-1)),
  worldTick: integer,
  elapsed: z.number().int().min(-1).max(wire.maximumElapsed),
  result: z.enum(wire.results),
});
const Entry = z.strictObject({
  marker: DuelClockMarker,
  receivedElapsedNanos: integer,
});
type Marker = z.infer<typeof DuelClockMarker>;
export const DuelClockReceipt = z.strictObject({
  schema: z.literal(1),
  kind: z.literal("rwf-native-duel-clock"),
  acceptance: z.literal("unaccepted"),
  source: z.literal("paper-custom-payload"),
  expected: Expected,
  complete: z.boolean(),
  error: z.literal(""),
  entries: z
    .array(Entry)
    .min(2)
    .max(wire.maximumElapsed + 3),
});
export const DuelClockStatus = z.strictObject({
  name: z.string().min(1),
  state: z.enum([
    "ARMED",
    "WAITING",
    "LIVE",
    "TERMINAL",
    "FAILED",
    "SEALING",
    "SEALED",
  ]),
  markers: z
    .number()
    .int()
    .min(0)
    .max(wire.maximumElapsed + 3),
  error: z.string(),
  receipt: z.string().min(1),
});

if (
  wire.version !== 1 ||
  wire.channel !== "thestorm:rwf_duel_clock" ||
  wire.bytes !== 54 ||
  wire.byteOrder !== "big-endian" ||
  wire.maximumElapsed !== 1200 ||
  JSON.stringify(wire.opponents) !== JSON.stringify(duel.opponents) ||
  JSON.stringify(wire.results) !== JSON.stringify(duel.results) ||
  JSON.stringify(wire.sides) !== JSON.stringify(["red", "blue"]) ||
  JSON.stringify(wire.modes) !== JSON.stringify(["authored", "external"]) ||
  JSON.stringify(wire.markers) !==
    JSON.stringify(["begin", "tick", "terminal"]) ||
  JSON.stringify(wire.packet) !==
    JSON.stringify(Object.keys(DuelClockMarker.shape)) ||
  JSON.stringify(wire.expected) !==
    JSON.stringify(Object.keys(Expected.shape)) ||
  JSON.stringify(wire.entry) !== JSON.stringify(Object.keys(Entry.shape)) ||
  JSON.stringify(wire.receipt) !==
    JSON.stringify(Object.keys(DuelClockReceipt.shape)) ||
  JSON.stringify(wire.status) !==
    JSON.stringify(Object.keys(DuelClockStatus.shape))
)
  throw new Error("Unsupported native duel clock contract");

/** Revalidate original receiver evidence without inferring server timing from console polling. */
export function validateDuelClock(
  raw: unknown,
): z.infer<typeof DuelClockReceipt> {
  const receipt = validateDuelPrefix(raw);
  if (!receipt.complete || receipt.entries.at(-1)?.marker.marker !== "terminal")
    throw new Error("Native duel clock lacks its terminal marker");
  return receipt;
}

/** A clip may finish at native tick 599 while the full duel continues in its separate journal. */
export function validateDuelPrefix(
  raw: unknown,
): z.infer<typeof DuelClockReceipt> {
  const receipt = DuelClockReceipt.parse(raw);
  const first = receipt.entries[0]?.marker;
  const last = receipt.entries.at(-1)?.marker;
  if (
    last === undefined ||
    first?.marker !== "begin" ||
    first.sequence !== 0 ||
    first.tick !== -1 ||
    first.elapsed !== -1 ||
    first.result !== "waiting" ||
    receipt.complete !== (last.marker === "terminal")
  )
    throw new Error("Native duel clock lacks its begin or terminal marker");
  let lastTime = -1;
  let lastWorldTick = -1;
  let previous: Marker | undefined;
  receipt.entries.forEach(({ marker, receivedElapsedNanos }, index) => {
    if (
      marker.match !== first.match ||
      marker.seed !== receipt.expected.seed ||
      marker.side !== receipt.expected.side ||
      marker.mode !== receipt.expected.mode ||
      marker.opponent !== receipt.expected.opponent ||
      marker.sequence !== index
    )
      throw new Error("Native duel clock identity or sequence changed");
    if (receivedElapsedNanos < lastTime || marker.worldTick < lastWorldTick)
      throw new Error("Native duel receive or world clock moved backwards");
    lastTime = receivedElapsedNanos;
    lastWorldTick = marker.worldTick;
    if (index === 0) return;
    if (marker.marker === "terminal") {
      if (
        index !== receipt.entries.length - 1 ||
        ["waiting", "live"].includes(marker.result)
      )
        throw new Error("Native terminal marker was not last");
      validateTerminal(marker, previous);
      return;
    }
    validateLive(marker, previous);
    previous = marker;
  });
  return receipt;
}

function validateLive(marker: Marker, previous: Marker | undefined): void {
  if (
    marker.marker !== "tick" ||
    marker.result !== "live" ||
    marker.tick < 0 ||
    marker.sequence !== marker.elapsed + 1 ||
    (previous === undefined && marker.elapsed !== 0) ||
    (previous !== undefined &&
      (marker.elapsed !== previous.elapsed + 1 ||
        marker.tick !== previous.tick + 1))
  )
    throw new Error("Native duel live ticks are not continuous");
}

function validateTerminal(marker: Marker, previous: Marker | undefined): void {
  if (
    marker.sequence !== marker.elapsed + 2 ||
    (previous === undefined &&
      (marker.elapsed !== -1 ||
        marker.tick !== -1 ||
        !["stopped", "cancelled"].includes(marker.result))) ||
    (previous !== undefined &&
      (marker.elapsed !== previous.elapsed || marker.tick !== previous.tick))
  )
    throw new Error("Native duel terminal clock changed");
}
