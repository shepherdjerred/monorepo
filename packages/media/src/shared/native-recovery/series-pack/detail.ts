import { z } from "zod";
import { NativeRecoveryDetailSchema } from "#shared/native-recovery.ts";
import { NativeLifecycleDetailSchema } from "#shared/native-recovery/lifecycle.ts";
import { NativeCompensationContinuationViewSchema } from "#shared/native-recovery/compensation-runtime.ts";
import { SeriesPackNativeCompensationScopeV3Schema } from "./scope.ts";
import { SeriesPackNativeFinishedV4Schema } from "./evidence.ts";

/** Explicit presentation protocol; the historical strict detail stays literal. */
export const SeriesPackNativeDetailV1Schema = z.strictObject({
  ...NativeRecoveryDetailSchema.omit({ scope: true, plan: true }).shape,
  schemaVersion: z.literal(1),
  protocol: z.literal("series_pack_native_compensation_v1"),
  scope: SeriesPackNativeCompensationScopeV3Schema,
  plan: SeriesPackNativeFinishedV4Schema.nullable(),
  continuations: z.tuple([]),
  compensationContinuations: z
    .array(NativeCompensationContinuationViewSchema)
    .max(1),
});

export const NativeRecoveryDetailProtocolSchema = z.union([
  NativeLifecycleDetailSchema,
  SeriesPackNativeDetailV1Schema,
]);

export type SeriesPackNativeDetailV1 = z.infer<
  typeof SeriesPackNativeDetailV1Schema
>;
