import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { SeriesPackPublicationOutcomeV3 } from "#shared/acquisition/series-pack-publication-v1.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { canonicalJson } from "#migration/profile-import.ts";

export function seriesPackSealPayload(
  input: { attemptId: string; operationId: string },
  intentHash: string,
  outcome: SeriesPackPublicationOutcomeV3,
) {
  return {
    schemaVersion: 1,
    kind: "seal_series_pack_publication_v1",
    attemptId: input.attemptId,
    operationId: input.operationId,
    intentHash,
    outcome,
    outcomeHash: identityHash(outcome),
    raw: canonicalJson(z.json().parse(outcome)),
  };
}

export function seriesPackSealOperationData(
  sealOperationId: string,
  payload: ReturnType<typeof seriesPackSealPayload>,
) {
  return {
    id: sealOperationId,
    kind: payload.kind,
    targetId: payload.attemptId,
    userId: null,
    status: "completed",
    idempotencyKey: `series-pack-publication-seal-v1:${payload.attemptId}`,
    payload: z.record(z.string(), z.json()).parse(payload),
  } satisfies Prisma.OperationUncheckedCreateInput;
}

export function seriesPackSealOutcomeData(
  payload: ReturnType<typeof seriesPackSealPayload>,
) {
  return {
    outcome: z.record(z.string(), z.json()).parse(payload.outcome),
    outcomeHash: payload.outcomeHash,
  };
}
