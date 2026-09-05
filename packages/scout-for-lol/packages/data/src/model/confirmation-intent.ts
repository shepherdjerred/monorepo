import { z } from "zod";
import { BucksStakeSchema } from "./bryan-bucks.ts";

/**
 * The payload of a confirmation intent: an actor-bound, single-use, expiring
 * row that a human confirms, at which point the real action executes.
 *
 * `kind` is the only discriminator. It used to be stored twice — a column
 * beside the payload and a field inside it — which made a disagreement
 * representable and forced a runtime assertion at confirm time. One field
 * makes that state unrepresentable instead.
 */
export const ConfirmationIntentPayloadSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("dare_fund") }),
  z.strictObject({ kind: z.literal("dare_accept") }),
  z.strictObject({ kind: z.literal("dare_decline") }),
  z.strictObject({
    kind: z.literal("dare_contribute"),
    amount: BucksStakeSchema,
  }),
  z.strictObject({ kind: z.literal("dare_cancel") }),
]);
export type ConfirmationIntentPayload = z.infer<
  typeof ConfirmationIntentPayloadSchema
>;

/** Every kind a stored confirmation intent may carry. */
export const ConfirmationIntentKindSchema = z.enum([
  "dare_fund",
  "dare_accept",
  "dare_decline",
  "dare_contribute",
  "dare_cancel",
]);
export type ConfirmationIntentKind = z.infer<
  typeof ConfirmationIntentKindSchema
>;
