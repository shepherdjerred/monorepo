import { isDeepStrictEqual } from "node:util";
import { Prisma } from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import { queryFixtureDatabase } from "#testing/query-client.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  CommittedQuarantinePlexReceiptSchema,
  type CommittedQuarantinePlexReceipt,
} from "#shared/plex-binding/watch.ts";
import { z } from "zod";
import { RemovalPlanSchema } from "#automation/files/types.ts";

/** Simulated elapsed quarantine at FIRST writes; authority clocks and SQL remain real. */
export async function elapsedQuarantineClient(
  db: Database,
  input: {
    operationId: string;
    decisionId: string;
    mediaIds: readonly string[];
    timing?: "elapsed" | "current_transition";
  },
) {
  const operation = await db.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  if (operation.result !== null)
    throw new Error("Elapsed quarantine requires an uncommitted operation");
  const decisions = await db.retentionDecision.findMany({
    where: {
      mediaId: { in: [...input.mediaIds] },
      edition: "default",
      state: "grace_period",
    },
    include: { plexProjection: true },
    orderBy: { id: "asc" },
  });
  if (
    decisions.length !== input.mediaIds.length ||
    !decisions.some((row) => row.id === input.decisionId)
  )
    throw new Error(
      "Elapsed quarantine requires the exact complete decision cohort",
    );
  let committedAt = new Date(
    input.timing === "current_transition"
      ? Date.now()
      : Date.now() - 7 * 86_400_000 - 3_600_000,
  );
  let purgeAfter = new Date(committedAt.getTime() + 7 * 86_400_000);
  for (const decision of decisions) {
    if (
      decision.quarantinedAt !== null ||
      decision.purgeAfter !== null ||
      decision.plexProjection === null ||
      decision.warningAcceptedAt === null ||
      decision.warningAcceptedAt >= committedAt
    )
      throw new Error(
        "Elapsed quarantine requires original warning-before-quarantine chronology",
      );
  }
  const template = Prisma.sql`UPDATE "Operation" SET result=COALESCE(result,'{}'::jsonb) || jsonb_build_object('quarantinePlexReceipt',${"receipt"}::jsonb)
    WHERE id=${input.operationId} AND NOT (COALESCE(result,'{}'::jsonb) ? 'quarantinePlexReceipt')`;
  let transitionCount = 0;
  let manifestHash: string | null = null;
  let receipt: CommittedQuarantinePlexReceipt | null = null;
  let original: CommittedQuarantinePlexReceipt | null = null;
  const client = queryFixtureDatabase(db, {
    query: {
      retentionDecision: {
        async updateMany({ args, query }) {
          if (args.data.state !== "quarantined") return query(args);
          if (
            transitionCount !== 0 ||
            !isDeepStrictEqual(args.where, {
              mediaId: { in: [...input.mediaIds] },
              edition: "default",
              state: "grace_period",
            }) ||
            !(args.data.quarantinedAt instanceof Date) ||
            !(args.data.purgeAfter instanceof Date) ||
            args.data.purgeAfter.getTime() -
              args.data.quarantinedAt.getTime() !==
              7 * 86_400_000
          )
            throw new Error(
              "Elapsed quarantine transition differs from the selected first write",
            );
          transitionCount++;
          if (input.timing === "current_transition") {
            // The Files authority clock may simulate hashing duration; SQL birth time stays real.
            committedAt = new Date();
            purgeAfter = new Date(committedAt.getTime() + 7 * 86_400_000);
          }
          const manifest = RemovalPlanSchema.parse(args.data.manifest);
          if (
            !isDeepStrictEqual(
              [
                ...new Set(manifest.assets.flatMap((entry) => entry.mediaIds)),
              ].sort(),
              [...input.mediaIds].sort(),
            )
          )
            throw new Error(
              "Elapsed quarantine manifest differs from the complete selected media cohort",
            );
          manifestHash = identityHash(args.data.manifest);
          return query({
            ...args,
            data: { ...args.data, quarantinedAt: committedAt, purgeAfter },
          });
        },
      },
      async $executeRaw({ args, query }) {
        if (
          !args.strings.some((part) => part.includes("quarantinePlexReceipt"))
        ) {
          const result: unknown = await query(args);
          return result;
        }
        if (
          receipt !== null ||
          transitionCount !== 1 ||
          args.values[1] !== input.operationId ||
          !isDeepStrictEqual(args.strings, template.strings) ||
          args.values.length !== 2
        )
          throw new Error(
            "Elapsed quarantine receipt differs from the exact first-write SQL template",
          );
        const raw = z.string().parse(args.values[0]);
        original = CommittedQuarantinePlexReceiptSchema.parse(JSON.parse(raw));
        if (
          original.operationId !== input.operationId ||
          original.decisionId !== input.decisionId ||
          original.manifestHash !== manifestHash ||
          !isDeepStrictEqual(
            original.decisions,
            decisions.map((row) => ({
              decisionId: row.id,
              mediaId: row.mediaId,
              beforeVersion: row.version,
              quarantinedVersion: row.version + 1,
              projectionHash: row.plexProjection?.projectionHash,
            })),
          )
        )
          throw new Error(
            "Elapsed quarantine receipt changed its original parent or complete decision cohort",
          );
        if (original.committedAt !== committedAt.toISOString())
          throw new Error(
            "Quarantine receipt did not use its actual first decision transition timestamp",
          );
        receipt = original;
        // Observe the producer's ONE literal receipt; never rewrite SQL or stored history.
        const result: unknown = await query(args);
        return result;
      },
    },
  });
  const assertCommitted = async () => {
    if (transitionCount !== 1 || receipt === null || original === null)
      throw new Error(
        "Actual quarantine did not consume the exact first-write timing seam",
      );
    const row = await db.operation.findUniqueOrThrow({
      where: { id: input.operationId },
    });
    const raw = z
      .object({ quarantinePlexReceipt: z.json() })
      .parse(row.result).quarantinePlexReceipt;
    if (
      !isDeepStrictEqual(raw, receipt) ||
      !isDeepStrictEqual(
        { ...receipt, committedAt: original.committedAt },
        original,
      ) ||
      !isDeepStrictEqual(row.payload, operation.payload)
    )
      throw new Error(
        "Elapsed quarantine changed immutable receipt or command evidence",
      );
    const projections = await db.retentionPlexProjection.findMany({
      where: { decisionId: { in: decisions.map((value) => value.id) } },
      orderBy: { decisionId: "asc" },
    });
    if (
      !isDeepStrictEqual(
        projections,
        decisions.map((value) => value.plexProjection),
      )
    )
      throw new Error(
        "Elapsed quarantine rewrote original decision-birth projections",
      );
    const current = await db.retentionDecision.findMany({
      where: { id: { in: decisions.map((value) => value.id) } },
      orderBy: { id: "asc" },
    });
    for (const decision of current) {
      if (
        decision.quarantinedAt?.getTime() !== committedAt.getTime() ||
        decision.purgeAfter?.getTime() !== purgeAfter.getTime() ||
        identityHash(decision.manifest) !== receipt.manifestHash
      )
        throw new Error(
          "Elapsed quarantine timestamps or original manifest changed",
        );
    }
    return {
      receipt: raw,
      receiptHash: identityHash(raw),
      committedAt,
      purgeAfter,
    };
  };
  return {
    db: client,
    assertCommitted,
  };
}
