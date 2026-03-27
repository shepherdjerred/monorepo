import { z } from "zod/v4";

export const TimerPhaseSchema = z.enum([
  "first_half",
  "past_50",
  "past_75",
  "last_5min",
  "overtime",
]);

export const TimerStateSchema = z.object({
  durationMs: z.number().int().min(0),
  elapsedMs: z.number().int().min(0),
  warningsEmitted: z.array(z.enum(["50%", "75%", "5min"])),
  lastCheckpointMs: z.number().int(),
});

export type TimerPhase = z.infer<typeof TimerPhaseSchema>;
export type TimerState = z.infer<typeof TimerStateSchema>;
