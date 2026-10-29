import type { Prisma } from "#generated/prisma/client.ts";
import { HandoffScopeSchema } from "#shared/handoff.ts";
import { BundleReportSchema } from "#shared/migration-handoff.ts";

/** Only unresolved household claims for this physical scope block reconciliation. */
export async function unresolvedRecoveryClaims(
  db: Prisma.TransactionClient,
  input: {
    planIds: string[];
    mediaIds: string[];
    evaluatedRecords?: {
      captureHash: string;
      provenanceKey: string;
      recordDigest: string;
    }[];
  },
) {
  const plans = await db.mediaHandoffPlan.findMany({
    where: { id: { in: input.planIds }, state: "applied" },
    include: { bundleReview: true },
  });
  const media = await db.mediaItem.findMany({
    where: { id: { in: input.mediaIds } },
    include: { parent: { include: { parent: true } } },
  });
  const related = media
    .flatMap((item) => [item, item.parent, item.parent?.parent])
    .filter((item) => item !== null && item !== undefined);
  for (const plan of plans) {
    const scope = HandoffScopeSchema.parse(plan.scope);
    const report = BundleReportSchema.parse(plan.bundleReview.report);
    for (const entry of report.entries) {
      const record = entry.sourceRecord;
      if (record.kind !== "request" || !record.active) continue;
      // TV request IDs identify the series, including season/episode requests;
      // TMDB movie, series and episode numeric IDs are separate namespaces.
      const affectsScope =
        entry.mediaIds.some((id) => related.some((item) => item.id === id)) ||
        (record.externalIds.tmdb !== undefined &&
          related.some(
            (item) =>
              item.kind === (record.scope === "movie" ? "movie" : "series") &&
              item.tmdbId === record.externalIds.tmdb,
          ));
      if (!affectsScope) continue;
      if (
        !evaluatedRecord(input.evaluatedRecords ?? [], entry) &&
        !scope.claims.some(
          (claim) => claim.provenanceKey === entry.provenanceKey,
        )
      )
        return true;
    }
  }
  return false;
}

function evaluatedRecord(
  records: {
    captureHash: string;
    provenanceKey: string;
    recordDigest: string;
  }[],
  entry: {
    captureHash: string;
    provenanceKey: string;
    observationHash: string;
  },
) {
  return records.some(
    (stored) =>
      stored.captureHash === entry.captureHash &&
      stored.provenanceKey === entry.provenanceKey &&
      stored.recordDigest === entry.observationHash,
  );
}
