import type { Prisma, ReleaseCandidate } from "#generated/prisma/client.ts";
import type { CanonicalIdentity } from "#shared/acquisition/identity.ts";
import type { LibraryManagementInvocation } from "#infrastructure/acquisition-identity/library-policy.ts";
import { parseSeriesSeasonSetV1 } from "#domain/acquisition-identity/series-season-set.ts";
import { readSeriesPackSelectionV1 } from "./selection.ts";
import { assertSeriesPackAuthorityV1 } from "./authority.ts";

/** Absence of the new stored selector retains the literal original parser and source factories. */
export async function selectedSeriesPackIdentityV1(
  tx: Prisma.TransactionClient,
  release: ReleaseCandidate,
  input: {
    operationId: string;
    canonical: CanonicalIdentity;
    mediaIds: string[];
    libraryManagement?: LibraryManagementInvocation | undefined;
  },
) {
  if (
    input.canonical.kind !== "series" ||
    parseSeriesSeasonSetV1(release.title).status === "not_applicable"
  )
    return;
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  const selected = readSeriesPackSelectionV1(operation);
  if (selected === null) return;
  const invocation = input.libraryManagement;
  if (invocation === undefined)
    throw new Error("Series pack acquisition lost its original invocation");
  // The actual coordinator and supplied ReleaseCandidate are historical parents,
  // although their bounded operational reads precede this explicit dispatch.
  invocation.budget.consume(2);
  return assertSeriesPackAuthorityV1(
    tx,
    {
      captured: selected.selected,
      release,
      canonical: input.canonical,
      mediaIds: input.mediaIds,
      primaryMediaId: selected.primaryMediaId,
    },
    invocation,
  );
}
