import { z } from "zod";
import { AcquisitionPlexPublicationReceiptSchema } from "#shared/plex-binding/publication.ts";

/** Household approval has no personal request. Historical receipt v1 stays literal. */
export const ManagedEpisodePlexReceiptV2Schema =
  AcquisitionPlexPublicationReceiptSchema.extend({
    schemaVersion: z.literal(2),
    attempt: AcquisitionPlexPublicationReceiptSchema.shape.attempt.extend({
      sponsorRequestId: z.null(),
    }),
  });

export const DefaultAcquisitionPlexReceiptSchema = z.union([
  AcquisitionPlexPublicationReceiptSchema,
  ManagedEpisodePlexReceiptV2Schema,
]);
export type DefaultAcquisitionPlexReceipt = z.infer<
  typeof DefaultAcquisitionPlexReceiptSchema
>;

export function acquisitionPlexReceiptMarker(result: unknown) {
  const stored = z.record(z.string(), z.unknown()).nullable().parse(result);
  const old =
    stored !== null && Object.hasOwn(stored, "acquisitionPlexReceipt");
  const managed =
    stored !== null && Object.hasOwn(stored, "managedEpisodePlexReceiptV2");
  if (old && managed)
    throw new Error("Acquisition Plex receipt has conflicting families");
  if (old)
    return {
      key: "acquisitionPlexReceipt",
      version: 1,
      raw: stored["acquisitionPlexReceipt"],
    } as const;
  if (managed)
    return {
      key: "managedEpisodePlexReceiptV2",
      version: 2,
      raw: stored["managedEpisodePlexReceiptV2"],
    } as const;
  return null;
}
