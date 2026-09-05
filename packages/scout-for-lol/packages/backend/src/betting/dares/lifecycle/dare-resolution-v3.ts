import type { DareContractV3 } from "@scout-for-lol/data";
import type { Prisma } from "#generated/prisma/client/index.js";
import type { dareV2MoneyFactsInTransaction } from "#src/betting/dares/settlement/dare-ledger-v2.ts";
import {
  payDareV2TargetsInTransaction,
  refundDareV2ContributionsInTransaction,
} from "#src/betting/dares/settlement/dare-ledger-v2.ts";
import type { DareProofV3 } from "#src/betting/dares/settlement/dare-settle-types-v2.ts";
import type { Db } from "#src/database/index.ts";

type ActiveRelationalDareRow = Prisma.BucksDareV2GetPayload<{
  include: { targets: true };
}>;
type DareV2MoneyFacts = Awaited<
  ReturnType<typeof dareV2MoneyFactsInTransaction>
>;

async function payAchievedDare(
  tx: Db,
  input: {
    dare: ActiveRelationalDareRow;
    contract: DareContractV3;
    proof: DareProofV3;
    facts: DareV2MoneyFacts;
  },
): Promise<void> {
  const payeeKeys = new Set(input.proof.targetKeys);
  const payees = input.dare.targets
    .filter((target) => payeeKeys.has(target.targetKey))
    .map((target) => {
      if (target.bucksAccountId === null || target.acceptedAt === null) {
        throw new Error(
          `Achieved Dare v3 target ${target.id.toString()} is not accepted.`,
        );
      }
      return {
        id: target.id,
        targetKey: target.targetKey,
        discordId: target.discordId,
        alias: target.alias,
        bucksAccountId: target.bucksAccountId,
      };
    })
    .toSorted((left, right) => left.targetKey.localeCompare(right.targetKey));
  const firstPayee = payees[0];
  if (firstPayee === undefined) {
    throw new Error("An achieved Dare v3 has no accepted payee.");
  }
  await payDareV2TargetsInTransaction(
    tx,
    input.contract.competition.kind === "race" && payees.length > 1
      ? {
          facts: input.facts,
          targets: payees,
          remainderTargetId: firstPayee.id,
        }
      : { facts: input.facts, targets: payees },
  );
}

export async function distributeDareResolutionV3(
  tx: Db,
  input: {
    dare: ActiveRelationalDareRow;
    contract: DareContractV3;
    proof: DareProofV3 | null;
    facts: DareV2MoneyFacts;
    value: boolean | null;
  },
): Promise<void> {
  if (input.value === true) {
    if (input.proof === null) {
      throw new Error("An achieved Dare v3 has no proof.");
    }
    await payAchievedDare(tx, {
      dare: input.dare,
      contract: input.contract,
      proof: input.proof,
      facts: input.facts,
    });
    return;
  }
  await refundDareV2ContributionsInTransaction(tx, {
    facts: input.facts,
    resolution: input.value === null ? "voided" : "unachieved",
    withCut: input.value === false,
    ...(input.value === null ? { voidReason: "missing_evidence" } : {}),
  });
}
