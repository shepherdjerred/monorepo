import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { validateNativePlexReceipt } from "#infrastructure/plex-binding/native/native-version.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import type { NativeReceiptReadPort } from "#infrastructure/plex-binding/native/receipt-port.ts";

export type ArchiveReadOptions = {
  budget?: PublicationAuthorityReadBudget | undefined;
  projection?: NativeReceiptReadPort | undefined;
};

export type ArchiveQueriedReceipt = Prisma.NativeRecoveryReceiptGetPayload<{
  include: { plan: true };
}>;

/** One complete immutable receipt frontier within one scope/locked phase.
 * Current assets, eligibility and coordinator checks are deliberately outside it.
 * Every actual query is charged; different walks and transactions start empty.
 */
export class ArchiveReceiptProjection implements NativeReceiptReadPort {
  private readonly rows = new Map<
    string,
    { row: ArchiveQueriedReceipt; hash: string }
  >();

  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly budget: PublicationAuthorityReadBudget,
  ) {}

  assertTransaction(
    tx: Prisma.TransactionClient,
    budget: PublicationAuthorityReadBudget,
  ) {
    if (tx !== this.transaction || budget !== this.budget)
      throw new Error(
        "Archive receipt projection belongs to another transaction or budget",
      );
  }

  async validateQueried(
    tx: Prisma.TransactionClient,
    row: ArchiveQueriedReceipt,
    budget: PublicationAuthorityReadBudget,
  ) {
    this.assertTransaction(tx, budget);
    const previous = this.rows.get(row.id);
    const hash = snapshotHash(nativeJson(row));
    if (previous !== undefined) {
      if (
        previous.hash !== hash ||
        snapshotHash(nativeJson(previous.row)) !== hash
      )
        throw new Error(
          "Archive queried immutable receipt changed within phase",
        );
      return previous.row;
    }
    await validateNativePlexReceipt(tx, row, budget);
    this.rows.set(row.id, { row, hash });
    return row;
  }

  async read(
    tx: Prisma.TransactionClient,
    id: string,
    budget: PublicationAuthorityReadBudget,
  ) {
    this.assertTransaction(tx, budget);
    const previous = this.rows.get(id);
    if (previous !== undefined)
      return this.validateQueried(tx, previous.row, budget);
    const row = await tx.nativeRecoveryReceipt.findUniqueOrThrow({
      where: { id },
      include: { plan: true },
    });
    budget.consume(2);
    return this.validateQueried(tx, row, budget);
  }

  async find(
    tx: Prisma.TransactionClient,
    assetId: string,
    epoch: number,
    budget: PublicationAuthorityReadBudget,
  ) {
    this.assertTransaction(tx, budget);
    // Already queried rows remain part of the result. The SQL query still proves
    // that no additional matching candidate exists; it excludes only known IDs.
    const rows = await tx.nativeRecoveryReceipt.findMany({
      where: {
        id: { notIn: [...this.rows.keys()] },
        recoveryEpoch: epoch,
        selection: { path: ["bindings"], array_contains: [{ assetId }] },
      },
      include: { plan: true },
      orderBy: { createdAt: "desc" },
      take: budget.takeWeighted(2),
    });
    budget.consume(rows.length * 2);
    for (const row of rows) await this.validateQueried(tx, row, budget);
    const matching = [];
    for (const { row } of this.rows.values()) {
      if (row.recoveryEpoch !== epoch) continue;
      const selection = z
        .object({ bindings: z.array(z.object({ assetId: z.uuid() })) })
        .parse(row.selection);
      if (selection.bindings.some((binding) => binding.assetId === assetId))
        matching.push(await this.validateQueried(tx, row, budget));
    }
    return matching;
  }
}
