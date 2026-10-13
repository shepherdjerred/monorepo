import { z } from "zod";
import type { ScoutClientObservation } from "@scout-for-lol/data";
import { withoutScoutClientPayloadCredentials } from "@scout-for-lol/data/scout-client/protocol.schema.ts";
import type { ScoutClientObservation as StoredObservation } from "#generated/prisma/client/index.js";
import { computeSha256Digest } from "#src/storage/object-integrity.ts";

const EnvelopeSchema = z.strictObject({
  source: z.enum(["received", "legacy_record"]),
  headers: z.record(z.string(), z.json()),
});

export function receivedObservationEnvelope(
  observation: ScoutClientObservation,
) {
  const headers = z
    .record(z.string(), z.json())
    .parse(
      Object.fromEntries(
        Object.entries(observation).filter(
          ([key, value]) => key !== "payload" && value !== undefined,
        ),
      ),
    );
  return { source: "received" as const, headers };
}

/** Legacy provenance is explicit: derived DB metadata is not the original envelope. */
export function observationArchiveEnvelope(row: StoredObservation) {
  if (row.rawEnvelope !== null) return EnvelopeSchema.parse(row.rawEnvelope);
  return {
    source: "legacy_record" as const,
    headers: {
      observationId: row.observationId,
      sequence: row.sequence.toString(),
      capturedAt: row.capturedAt.toISOString(),
      protocolVersion: row.protocolVersion,
      schemaVersion: row.schemaVersion,
      appVersion: row.appVersion,
      kind: row.kind,
      localPuuid: row.localPuuid,
      localLcuUuid: row.localLcuUuid,
      platformId: row.platformId,
      leaguePatch: row.leaguePatch,
      lobbyId: row.lobbyId,
      gameId: row.gameId,
    },
  };
}

export function rawObservationObject(row: StoredObservation) {
  const envelope = observationArchiveEnvelope(row);
  const document = {
    archiveVersion: 1,
    deviceId: row.deviceId,
    receivedAt: row.receivedAt.toISOString(),
    bodyDigest: row.bodyDigest,
    envelopeSource: envelope.source,
    envelope: envelope.headers,
    payload: withoutScoutClientPayloadCredentials(z.json().parse(row.payload)),
  };
  const bytes = new TextEncoder().encode(
    JSON.stringify(orderedJson(z.json().parse(document))),
  );
  const digest = computeSha256Digest(bytes);
  const date = row.receivedAt.toISOString().slice(0, 10).replaceAll("-", "/");
  return {
    key: `scout-client/observations/${date}/${row.deviceId}/${row.observationId}/${digest}.json`,
    digest,
    bytes,
  };
}

/** JSONB reorders object keys; retries must still produce exactly the same bytes. */
function orderedJson(
  value: ScoutClientObservation["payload"],
): ScoutClientObservation["payload"] {
  if (Array.isArray(value)) return value.map((item) => orderedJson(item));
  return value !== null && typeof value === "object"
    ? Object.fromEntries(
        Object.entries(value)
          .toSorted(([left], [right]) =>
            left === right ? 0 : left < right ? -1 : 1,
          )
          .map(([key, child]) => [key, orderedJson(child)]),
      )
    : value;
}
