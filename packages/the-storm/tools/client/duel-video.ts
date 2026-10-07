import { z } from "zod";
import wire from "#client-duel-video-wire";
import {
  DuelClockMarker,
  DuelClockReceipt,
  validateDuelPrefix,
} from "./duel-clock.ts";
import { FrameReceipt, validateFrameInventory } from "./video-frames.ts";

const Binding = z.strictObject({
  index: z.number().int().min(0).max(899),
  markerReceivedNanos: z.number().int().nonnegative(),
  marker: DuelClockMarker,
  sourceFrame: z.number().int().min(0).max(899),
  clientWorldTick: z.number().int().nonnegative(),
});
const Window = z.strictObject({
  window: z.literal("first-600-live-ticks-hold-terminal-frame"),
  liveTicks: z.literal(600),
  frames: z.literal(900),
  startedElapsedNanos: z.number().int().nonnegative(),
  terminalFrame: z.number().int().min(-1).max(899),
  clock: DuelClockReceipt,
  bindings: z.array(Binding).length(900),
});
export const DuelFrameReceipt = z.strictObject({
  ...FrameReceipt.shape,
  schema: z.literal(3),
  kind: z.literal("rwf-rendered-duel-frames"),
  requestedFrames: z.literal(900),
  duel: Window,
});
export type DuelFrameReceipt = z.infer<typeof DuelFrameReceipt>;

if (
  JSON.stringify(wire) !==
  JSON.stringify({
    version: 3,
    worldTickSource: "latest-received-paper-marker",
    kind: "rwf-rendered-duel-frames",
    liveTicks: 600,
    frames: 900,
    window: "first-600-live-ticks-hold-terminal-frame",
    receipt: Object.keys(DuelFrameReceipt.shape),
    duel: Object.keys(Window.shape),
    binding: Object.keys(Binding.shape),
  })
)
  throw new Error("Unsupported native duel video contract");

export function validateDuelFrames(raw: unknown): DuelFrameReceipt {
  const receipt = DuelFrameReceipt.parse(raw);
  validateFrameInventory(receipt);
  const clock = validateDuelPrefix(receipt.duel.clock);
  const firstLive = clock.entries[1];
  const last = clock.entries.at(-1)?.marker;
  if (
    last === undefined ||
    firstLive?.marker.marker !== "tick" ||
    firstLive.marker.elapsed !== 0 ||
    firstLive.receivedElapsedNanos !== receipt.duel.startedElapsedNanos ||
    clock.entries.length > 602 ||
    last.elapsed > 599
  )
    throw new Error("Native video start or window clock changed");
  validateWindowEnd(receipt, last);
  receipt.duel.bindings.forEach((binding, index) => {
    validateBinding(receipt, binding, index);
  });
  return receipt;
}

function validateWindowEnd(
  receipt: DuelFrameReceipt,
  marker: z.infer<typeof DuelClockMarker>,
): void {
  if (receipt.duel.terminalFrame < 0) {
    if (
      marker.marker !== "tick" ||
      marker.elapsed !== 599 ||
      receipt.duel.clock.complete
    )
      throw new Error("Native video did not reach its full live window");
  } else if (
    marker.marker !== "terminal" ||
    !["win", "loss", "draw", "timeout"].includes(marker.result) ||
    !receipt.duel.clock.complete
  )
    throw new Error("Native video terminal frame lacks a completed duel");
}

function validateBinding(
  receipt: DuelFrameReceipt,
  binding: z.infer<typeof Binding>,
  index: number,
): void {
  const image = receipt.frames[index];
  const event = receipt.duel.clock.entries[binding.marker.sequence];
  if (
    image === undefined ||
    event === undefined ||
    binding.index !== index ||
    JSON.stringify(binding.marker) !== JSON.stringify(event.marker) ||
    binding.markerReceivedNanos !==
      event.receivedElapsedNanos - receipt.duel.startedElapsedNanos ||
    binding.markerReceivedNanos > image.frame.elapsedNanos ||
    binding.marker.elapsed < 0 ||
    binding.marker.elapsed > 599 ||
    (index === 0 && binding.marker.elapsed !== 0)
  )
    throw new Error("Native frame marker or render clock changed");
  const next = receipt.duel.clock.entries[binding.marker.sequence + 1];
  if (
    next !== undefined &&
    next.receivedElapsedNanos - receipt.duel.startedElapsedNanos <=
      image.frame.elapsedNanos
  )
    throw new Error("Native frame used a stale received marker");
  if (image.frame.worldTick !== binding.marker.worldTick)
    throw new Error(
      "Native frame world clock differs from its received Paper marker",
    );
  validatePixelSource(receipt, binding, image.sha256);
}

function validatePixelSource(
  receipt: DuelFrameReceipt,
  binding: z.infer<typeof Binding>,
  sha256: string,
): void {
  const terminal = receipt.duel.terminalFrame;
  if (terminal < 0 || binding.index < terminal) {
    if (
      binding.sourceFrame !== binding.index ||
      binding.marker.marker !== "tick"
    )
      throw new Error("Live native pixels were held or substituted");
  } else {
    const source = receipt.frames[terminal];
    if (
      binding.sourceFrame !== terminal ||
      binding.marker.marker !== "terminal" ||
      source?.sha256 !== sha256
    )
      throw new Error("Held pixels differ from the original terminal render");
  }
}
