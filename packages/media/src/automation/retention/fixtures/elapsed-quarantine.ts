import type { Database } from "#infrastructure/database.ts";
import { queryFixtureDatabase } from "#testing/query-client.ts";
import { isDeepStrictEqual } from "node:util";

/** Eight elapsed days at the original quarantine writer; authority clocks remain real. */
export async function elapsedQuarantineClient(
  db: Database,
  decisionId: string,
) {
  const original = await db.retentionDecision.findUniqueOrThrow({
    where: { id: decisionId },
  });
  if (original.quarantinedAt !== null || original.purgeAfter !== null)
    throw new Error(
      "Elapsed quarantine requires its original unwritten timestamps",
    );
  const timestamp = new Date(Date.now() - 8 * 86_400_000);
  const purgeAfter = new Date(timestamp.getTime() + 7 * 86_400_000);
  let writes = 0;
  const client = queryFixtureDatabase(db, {
    query: {
      retentionDecision: {
        async updateMany({ args, query }) {
          if (args.data.state !== "quarantined") return query(args);
          if (
            writes !== 0 ||
            !isDeepStrictEqual(args.where, {
              mediaId: { in: [original.mediaId] },
              edition: "default",
              state: "grace_period",
            }) ||
            !(args.data.quarantinedAt instanceof Date) ||
            !(args.data.purgeAfter instanceof Date)
          )
            throw new Error(
              "Elapsed quarantine requires the original timestamp write",
            );
          writes++;
          return query({
            ...args,
            data: { ...args.data, quarantinedAt: timestamp, purgeAfter },
          });
        },
      },
    },
  });
  return {
    db: client,
    assertWritten: async () => {
      const decision = await db.retentionDecision.findUniqueOrThrow({
        where: { id: decisionId },
      });
      if (
        writes !== 1 ||
        decision.quarantinedAt?.getTime() !== timestamp.getTime() ||
        decision.purgeAfter?.getTime() !== purgeAfter.getTime()
      )
        throw new Error(
          "Actual quarantine did not retain its original timestamps",
        );
    },
  };
}
