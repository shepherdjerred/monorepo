import type { DareContract } from "@scout-for-lol/data";
import type { Prisma } from "#generated/prisma/client/index.js";
import type { dareMoneyFactsInTransaction } from "#src/betting/dares/settlement/dare-ledger.ts";
import {
  payDareTargetsInTransaction,
  refundDareContributionsInTransaction,
} from "#src/betting/dares/settlement/dare-ledger.ts";
import type { DareSettledMoney } from "#src/betting/dares/settlement/dare-announcement.ts";
import type { DareProof } from "#src/betting/dares/settlement/dare-settle-types.ts";
import type { Db } from "#src/database/index.ts";

type ActiveRelationalDareRow = Prisma.BucksDareGetPayload<{
  include: { targets: true };
}>;
type DareMoneyFacts = Awaited<ReturnType<typeof dareMoneyFactsInTransaction>>;

async function payAchievedDare(
  tx: Db,
  input: {
    dare: ActiveRelationalDareRow;
    contract: DareContract;
    proof: DareProof;
    facts: DareMoneyFacts;
  },
): Promise<DareSettledMoney["payouts"]> {
  const payeeKeys = new Set(input.proof.targetKeys);
  const payees = input.dare.targets
    .filter((target) => payeeKeys.has(target.targetKey))
    .map((target) => {
      if (target.bucksAccountId === null || target.acceptedAt === null) {
        throw new Error(
          `Achieved Dare target ${target.id.toString()} is not accepted.`,
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
    throw new Error("An achieved Dare has no accepted payee.");
  }
  return await payDareTargetsInTransaction(
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

export async function distributeDareResolution(
  tx: Db,
  input: {
    dare: ActiveRelationalDareRow;
    contract: DareContract;
    proof: DareProof | null;
    facts: DareMoneyFacts;
    value: boolean | null;
  },
): Promise<DareSettledMoney> {
  if (input.value === true) {
    if (input.proof === null) {
      throw new Error("An achieved Dare has no proof.");
    }
    const payouts = await payAchievedDare(tx, {
      dare: input.dare,
      contract: input.contract,
      proof: input.proof,
      facts: input.facts,
    });
    return {
      potTotal: input.facts.potTotal,
      payouts,
      refunds: [],
      voidReason: null,
    };
  }
  const voidReason = input.value === null ? "missing_evidence" : null;
  const refunds = await refundDareContributionsInTransaction(tx, {
    facts: input.facts,
    resolution: input.value === null ? "voided" : "unachieved",
    withCut: input.value === false,
    ...(voidReason === null ? {} : { voidReason }),
  });
  return { potTotal: input.facts.potTotal, payouts: [], refunds, voidReason };
}
