import { z } from "zod";
import { PlexBindingReasonSchema, plexSortedUnique } from "./contract.ts";

export const PLEX_BINDING_RESULT_MAX_BYTES = 128;
export const ReverifyPlexBindingInputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("reverify_plex_binding"),
  operationId: z.uuid(),
  recoveryEpoch: z.int().nonnegative(),
  assetIds: z.array(z.uuid()).min(1).max(100).refine(plexSortedUnique),
});
export const ReverifyPlexBindingResultSchema = z
  .discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("verified"),
      bindingCount: z.int().min(1).max(10_000),
    }),
    z.strictObject({ status: z.literal("superseded") }),
    z.strictObject({
      status: z.literal("protected"),
      reason: PlexBindingReasonSchema,
    }),
  ])
  .refine(
    (value) =>
      new TextEncoder().encode(JSON.stringify(value)).byteLength <=
      PLEX_BINDING_RESULT_MAX_BYTES,
    "Plex verification result exceeds its fixed history envelope",
  );
export type ReverifyPlexBindingInput = z.infer<
  typeof ReverifyPlexBindingInputSchema
>;
export type ReverifyPlexBindingResult = z.infer<
  typeof ReverifyPlexBindingResultSchema
>;
export type PlexBindingActivities = {
  reverifyPlexBinding: (
    input: ReverifyPlexBindingInput,
  ) => Promise<ReverifyPlexBindingResult>;
};
/** Invocation-local SDK budget; never serialize this port into an Activity argument or result. */
export type PlexBindingExecution = {
  readonly observed: { wall: number; monotonic: number };
  readonly expiresAtMs: number;
  readonly signal: AbortSignal;
  assertActive: () => void;
  checkpoint: () => Promise<void>;
};
