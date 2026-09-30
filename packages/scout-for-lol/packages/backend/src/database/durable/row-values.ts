import { type IsoInstant } from "@scout-for-lol/domain/identity/brands.ts";
import {
  VersionedPayloadEnvelopeSchema,
  type VersionedPayloadEnvelope,
} from "@scout-for-lol/domain/codec/versioned.ts";

/**
 * Column-level value conversions shared by the durable row codecs.
 *
 * Timestamps are stored as TIMESTAMP(3) and exposed to the domain as branded
 * ISO instants; the database normalises every instant to UTC millisecond
 * precision, which is the round-trip contract the codec tests pin down.
 *
 * The opaque `{ kind, version, data }` envelope every versioned payload column
 * carries is the domain's (`codec/versioned`); consumers import it from there
 * so every row codec shares one definition of "is even an envelope".
 */

export function dateFromIsoInstant(instant: IsoInstant): Date {
  return new Date(instant);
}

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
