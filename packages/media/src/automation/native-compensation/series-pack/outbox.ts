import { z } from "zod";
import { NativeCompensationActivityInputSchema } from "#shared/native-recovery/compensation-runtime.ts";
import { SeriesPackNativePublicationCommandV2Schema } from "#shared/native-recovery/series-pack/runtime.ts";

/** Private command parents stay in the operation/outbox. The credentialless
 * Workflow receives only this existing four-field Activity selector. */
export function seriesPackNativeEffectOutboxInputV1(
  kind:
    | "compensate_series_pack_native_publication_v1"
    | "publish_series_pack_native_compensation_v1",
  raw: unknown,
  operationId: string,
) {
  const command =
    kind === "compensate_series_pack_native_publication_v1"
      ? NativeCompensationActivityInputSchema.extend({
          kind: z.literal("compensate_series_pack_native_publication_v1"),
        }).parse(raw)
      : SeriesPackNativePublicationCommandV2Schema.extend({
          kind: z.literal("publish_series_pack_native_compensation_v1"),
          operationId: z.uuid(),
        }).parse(raw);
  if (command.operationId !== operationId)
    throw new Error("Native pack outbox lost its exact actual command");
  return {
    schemaVersion: 1,
    continuationId: command.continuationId,
    operationId,
    recoveryEpoch: command.recoveryEpoch,
  };
}
