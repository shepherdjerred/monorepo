import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { MovieRollbackInvocationV1Schema } from "#shared/movie-editions/rollback/operation.ts";
import { MovieAcquisitionIdentitySchema } from "#shared/movie-editions/management/contracts.ts";
import { CandidateSourceEvidenceSchema } from "#shared/acquisition/identity.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  candidateDigest,
  identityHash,
} from "#infrastructure/acquisition-identity/snapshot.ts";
import { readMovieRollbackPlexV1 } from "./records.ts";

/** Automatic search excludes only sources actually rejected by a completed
 * scoped inverse. Explicit owner release selection never calls this reader. */
export async function rejectedMovieSourceHashesV1(
  tx: Prisma.TransactionClient,
  scope: MovieEditionScope,
  budget: PublicationAuthorityReadBudget,
) {
  const rows = await tx.operation.findMany({
    where: {
      AND: [
        {
          result: {
            path: ["movieRollbackIntentV1", "intent", "scope"],
            equals: scope,
          },
        },
        {
          result: {
            path: ["movieRollbackPlexV1", "receipt", "schemaVersion"],
            equals: 1,
          },
        },
      ],
    },
    orderBy: { id: "asc" },
    take: budget.take,
  });
  budget.consume(rows.length);
  const rejected = new Set<string>();
  for (const row of rows) {
    const invocation = z
      .object({
        movieRollbackIntentV1: z.object({
          intent: z.object({ invocation: MovieRollbackInvocationV1Schema }),
        }),
      })
      .parse(row.result).movieRollbackIntentV1.intent.invocation;
    const completed = await readMovieRollbackPlexV1(tx, invocation, budget);
    if (
      completed?.operation.id !== row.id ||
      identityHash(completed.intent.scope) !== identityHash(scope)
    )
      throw new Error(
        "Automatic movie source rejection lost its actual scoped completed inverse",
      );
    const attempt = completed.parents.source.attempt;
    const identity = MovieAcquisitionIdentitySchema.parse(
      attempt.identityEvidence,
    );
    const release = await tx.releaseCandidate.findUniqueOrThrow({
      where: { id: attempt.releaseId },
    });
    budget.consume(1);
    if (
      identity.source.releaseId !== release.id ||
      identity.source.candidateDigest !== candidateDigest(release) ||
      identityHash(identity.scope) !== identityHash(scope)
    )
      throw new Error(
        "Automatic movie source rejection lost its literal acquired release",
      );
    rejected.add(
      CandidateSourceEvidenceSchema.parse(release.sourceEvidence).infoHash,
    );
  }
  return rejected;
}
