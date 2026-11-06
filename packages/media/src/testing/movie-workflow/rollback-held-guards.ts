import { expect } from "vitest";
import { Prisma } from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import { MoviePublicationIntentV2Schema } from "#shared/movie-editions/publication-v2.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { snapshotMoviePublicationAssetV2 } from "#infrastructure/movie-editions/publication/snapshot.ts";
import {
  findMoviePublicationReferenceV2,
  createMoviePublicationV2,
} from "#infrastructure/movie-editions/publication/store.ts";
import {
  holdCapturedMovieRollbackPredecessorV1,
  assertHeldMovieRollbackPredecessorV1,
} from "#infrastructure/movie-editions/publication/held-rollback-predecessor.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";

/** Read-only negative controls use the real prepared C and actual SQL TXs.
 * No capability from this test helper ever authorizes a write or native effect. */
export async function assertRollbackHeldPredecessorGuards(
  db: Database,
  attemptId: string,
) {
  const captured = await db.$transaction(async (tx) => {
    const budget = new PublicationAuthorityReadBudget();
    const row = await tx.mediaPublicationTransition.findUniqueOrThrow({
      where: { attemptId },
    });
    budget.consume(1);
    const intent = MoviePublicationIntentV2Schema.parse(row.intent);
    const predecessor = intent.entries[0].predecessor;
    if (predecessor === null) throw new Error("Actual C has no predecessor");
    await lockMovieCommand(tx, intent.scope);
    await tx.$queryRaw`SELECT id FROM "AcquisitionAttempt" WHERE id=${attemptId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "LibraryAsset" WHERE id=${predecessor.id} FOR UPDATE`;
    await tx.$queryRaw(
      Prisma.sql`SELECT "assetId" FROM "AssetCoverage" WHERE "assetId"=${predecessor.id} FOR UPDATE`,
    );
    await tx.$queryRaw`SELECT id FROM "SubtitleAsset" WHERE "assetId"=${predecessor.id} ORDER BY id FOR UPDATE`;
    const current = await snapshotMoviePublicationAssetV2(
      tx,
      intent.scope,
      predecessor.id,
      budget,
    );
    const grant = await findMoviePublicationReferenceV2(
      tx,
      { scope: intent.scope, asset: current },
      budget,
    );
    expect(identityHash(current)).toBe(identityHash(predecessor));
    expect(identityHash(grant)).toBe(
      identityHash(intent.entries[0].originalGrant),
    );
    const held = holdCapturedMovieRollbackPredecessorV1(tx, intent, budget);
    if (held === undefined)
      throw new Error("Actual C did not consume a rollback predecessor");
    assertHeldMovieRollbackPredecessorV1(tx, { intent, budget }, held);
    expect(() => {
      assertHeldMovieRollbackPredecessorV1(
        tx,
        { intent, budget: new PublicationAuthorityReadBudget() },
        held,
      );
    }).toThrow("crossed its transaction, original allowance or exact intent");
    const changed = MoviePublicationIntentV2Schema.parse({
      ...intent,
      transitionId: crypto.randomUUID(),
    });
    expect(() => {
      assertHeldMovieRollbackPredecessorV1(
        tx,
        { intent: changed, budget },
        held,
      );
    }).toThrow("crossed its transaction, original allowance or exact intent");
    await expect(createMoviePublicationV2(tx, changed, budget)).rejects.toThrow(
      "Movie publication intent cannot be replaced",
    );
    return { intent, budget, held };
  });
  await db.$transaction(async (other) => {
    expect(() => {
      assertHeldMovieRollbackPredecessorV1(other, captured, captured.held);
    }).toThrow("crossed its transaction, original allowance or exact intent");
    await expect(
      createMoviePublicationV2(
        other,
        captured.intent,
        captured.budget,
        captured.held,
      ),
    ).rejects.toThrow(
      "crossed its transaction, original allowance or exact intent",
    );
  });
}
