import type { Operation } from "#generated/prisma/client.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import { z } from "zod";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  SeriesPackPublicationInversePayloadV1Schema,
  SeriesPackPublicationPhysicalResultV1Schema,
} from "#shared/acquisition/series-pack-publication-v1.ts";

export function seriesPackInverseKeyV1(attemptId: string, batchIndex: number) {
  return `series-pack-publication-inverse-v1:${attemptId}:${String(batchIndex)}`;
}
export function readSeriesPackInverseV1(row: Operation) {
  const payload = SeriesPackPublicationInversePayloadV1Schema.parse(
    row.payload,
  );
  const result = SeriesPackPublicationPhysicalResultV1Schema.parse(row.result);
  const { command } = payload;
  if (
    row.kind !== command.kind ||
    row.userId !== null ||
    row.status !== "completed" ||
    row.targetId !== command.attemptId ||
    row.idempotencyKey !==
      seriesPackInverseKeyV1(command.attemptId, command.batchIndex) ||
    payload.raw !== canonicalJson(z.json().parse(command)) ||
    payload.commandHash !== identityHash(command) ||
    result.raw !== canonicalJson(z.json().parse(result.completion)) ||
    result.completionHash !== identityHash(result.completion) ||
    result.completion.commandHash !== payload.commandHash ||
    identityHash(
      result.completion.entries.map((entry) => entry.entryOperationId),
    ) !== identityHash(command.entryOperationIds)
  )
    throw new Error(
      "Series pack inverse lost its literal actual completion parent",
    );
  return {
    operationId: row.id,
    command,
    commandHash: payload.commandHash,
    completion: result.completion,
    completionHash: result.completionHash,
  };
}
