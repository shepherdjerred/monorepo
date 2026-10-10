import type { DuelClockReceipt } from "./duel-clock.ts";
import type { DuelFrameReceipt } from "./duel-video.ts";
import type { z } from "zod";

/** Every rendered prefix marker must match the independent original receiver clock. */
export function verifyDuelClockBinding(
  frames: DuelFrameReceipt,
  clock: z.infer<typeof DuelClockReceipt>,
) {
  const fullStart = clock.entries[1]?.receivedElapsedNanos;
  if (fullStart === undefined)
    throw new Error("Native full clock has no live anchor");
  frames.duel.clock.entries.forEach((entry, index) => {
    const full = clock.entries[index];
    if (
      full === undefined ||
      JSON.stringify(entry.marker) !== JSON.stringify(full.marker) ||
      entry.receivedElapsedNanos - frames.duel.startedElapsedNanos !==
        full.receivedElapsedNanos - fullStart
    )
      throw new Error(
        "Rendered window differs from the separate original clock",
      );
  });
}
