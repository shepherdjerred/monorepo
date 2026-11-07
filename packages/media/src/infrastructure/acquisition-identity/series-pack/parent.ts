import { z } from "zod";
import type {
  Operation,
  Prisma,
  ReleaseCandidate,
} from "#generated/prisma/client.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import {
  identityHash,
  candidateDigest,
} from "#infrastructure/acquisition-identity/snapshot.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  SeriesPackInterpretationEnvelopeV1Schema,
  type SeriesPackInterpretationV1,
  type CapturedSeriesPackV1,
} from "#shared/acquisition/series-pack-v1.ts";
import { seriesPackChanged } from "./catalog.ts";

export function seriesPackInterpretationKeyV1(
  value: Pick<
    SeriesPackInterpretationV1,
    "releaseId" | "sourceHash" | "canonicalHash" | "profile"
  >,
) {
  return `series-pack-interpretation-v1:${value.releaseId}:${value.sourceHash}:${value.canonicalHash}:${identityHash(value.profile)}`;
}

/** Historical resolution validates only literal immutable parents; it never grants current consent or file authority. */
export function readSeriesPackInterpretationV1(row: Operation) {
  const envelope = SeriesPackInterpretationEnvelopeV1Schema.parse(row.payload);
  const value = envelope.interpretation;
  if (
    row.kind !== "assess_series_pack_v1" ||
    row.status !== "completed" ||
    row.userId !== null ||
    row.targetId !== value.seriesId ||
    row.idempotencyKey !== seriesPackInterpretationKeyV1(value) ||
    envelope.raw !== canonicalJson(z.json().parse(value)) ||
    envelope.interpretationHash !== identityHash(value) ||
    identityHash(z.json().parse(JSON.parse(envelope.sourceRaw))) !==
      value.sourceHash ||
    identityHash(z.json().parse(JSON.parse(envelope.profileRaw))) !==
      value.profile.hash
  )
    throw new Error(
      "Series pack interpretation lost its immutable derived parent",
    );
  return {
    value,
    captured: {
      schemaVersion: 1 as const,
      operationId: row.id,
      interpretationHash: envelope.interpretationHash,
      attributes: value.attributes,
    },
  };
}

export async function loadSeriesPackInterpretationV1(
  tx: Prisma.TransactionClient,
  captured: CapturedSeriesPackV1,
  budget: PublicationAuthorityReadBudget,
  suppliedSource?: ReleaseCandidate,
) {
  const row = await tx.operation.findUniqueOrThrow({
    where: { id: captured.operationId },
  });
  budget.consume(1);
  const parent = readSeriesPackInterpretationV1(row);
  if (identityHash(parent.captured) !== identityHash(captured))
    throw new Error(
      "Series pack captured projection differs from its real parent",
    );
  const source =
    suppliedSource ??
    (await tx.releaseCandidate.findUniqueOrThrow({
      where: { id: parent.value.releaseId },
    }));
  if (suppliedSource === undefined) budget.consume(1);
  if (
    source.id !== parent.value.releaseId ||
    candidateDigest(source) !== parent.value.sourceHash
  )
    throw seriesPackChanged("The actual retained provider source changed");
  return { ...parent, source };
}
