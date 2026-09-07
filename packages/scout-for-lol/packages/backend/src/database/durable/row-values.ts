import { z } from "zod";
import { type IsoInstant } from "@scout-for-lol/domain/identity/brands.ts";

/**
 * Column-level value conversions shared by the durable row codecs.
 *
 * Timestamps are stored as TIMESTAMP(3) and exposed to the domain as branded
 * ISO instants; the database normalises every instant to UTC millisecond
 * precision, which is the round-trip contract the codec tests pin down.
 */

export function dateFromIsoInstant(instant: IsoInstant): Date {
  return new Date(instant);
}

/**
 * The wire shape every versioned payload column must carry: a strict
 * `{ kind, version, data }` envelope, structurally identical to the domain's
 * VersionedEnvelope with the `data` left opaque. The owning feature decodes
 * `data` with its own versioned codec, but a column that is not even an
 * envelope is broken persisted data and fails loudly.
 */
export type VersionedPayloadEnvelope = {
  readonly kind: string;
  readonly version: number;
  readonly data: unknown;
};
export const VersionedPayloadEnvelopeSchema = z.strictObject({
  kind: z.string().min(1),
  version: z.int().min(1),
  data: z.unknown(),
});

export function parsePayloadEnvelopeColumn(
  column: string,
): VersionedPayloadEnvelope {
  return VersionedPayloadEnvelopeSchema.parse(JSON.parse(column));
}

export function serializePayloadEnvelope(
  envelope: VersionedPayloadEnvelope,
): string {
  return JSON.stringify(VersionedPayloadEnvelopeSchema.parse(envelope));
}
