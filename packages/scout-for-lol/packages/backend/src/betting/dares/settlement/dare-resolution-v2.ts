import {
  dareV2MoneyFactsInTransaction,
  payDareV2TargetsInTransaction,
  refundDareV2ContributionsInTransaction,
} from "#src/betting/dares/settlement/dare-ledger-v2.ts";
import type {
  DareFinalityV2,
  DareProofV2,
} from "#src/betting/dares/evaluation/dare-proof-v2.ts";
import { claimActiveDareV2Settlement } from "#src/betting/dares/settlement/dare-settlement-claim-v2.ts";
import { recordTerminalDareAnnouncement } from "#src/betting/dares/settlement/dare-announcement.ts";
import type { DareNotificationDisposition } from "#src/betting/dares/presentation/notify/dare-notification-outbox.ts";
import type { DareContractV2 } from "@scout-for-lol/data";
import type { Db } from "#src/database/index.ts";

/**
 * The step that makes a Dare terminal, and everything that has to commit
 * with it.
 *
 * Lifted out of `dare-settle-v2.ts` unchanged when that file crossed its line
 * cap. It is its own sub-domain rather than an arbitrary cut: this is where a
 * settlement's DURABLE side effects are decided — the payout or refund, the
 * outbox row, the callout retirement — and all three have to land in the one
 * transaction or none of them do. Both entry points in the settler call it,
 * and so will anything that resolves a Dare later.
 */
async function freshFacts(
  tx: Db,
  input: {
    dareId: number;
    matchId?: string | undefined;
    serverId: string;
    potTotal: number;
    plainLanguage: string;
    targetAliases: string[];
  },
) {
  return await dareV2MoneyFactsInTransaction(tx, {
    contractVersion: 2,
    dareId: input.dareId,
    ...(input.matchId === undefined ? {} : { matchId: input.matchId }),
    serverId: input.serverId,
    potTotal: input.potTotal,
    targetAliases: input.targetAliases,
    conditionSummary: input.plainLanguage,
  });
}

export async function resolveFinalDareV2(
  tx: Db,
  input: {
    dare: {
      id: number;
      serverId: string;
      potTotal: number;
      targets: readonly {
        id: number;
        targetKey: string;
        discordId: string;
        alias: string;
        bucksAccountId: number | null;
        acceptedAt: Date | null;
      }[];
    };
    contract: DareContractV2;
    matchId?: string | undefined;
    finality: DareFinalityV2;
    proof: DareProofV2 | null;
    now: Date;
    notify: DareNotificationDisposition;
  },
): Promise<"achieved" | "unachieved" | "voided"> {
  const value = input.finality.value;
  const resolution = await claimActiveDareV2Settlement(tx, {
    dareId: input.dare.id,
    value,
    proof: input.proof,
    now: input.now,
    contractVersion: "v2",
    refreshCallout: false,
  });
  const facts = await freshFacts(tx, {
    dareId: input.dare.id,
    matchId: input.matchId,
    serverId: input.dare.serverId,
    potTotal: input.dare.potTotal,
    plainLanguage: input.contract.plainLanguage,
    targetAliases: input.dare.targets.map((target) => target.alias),
  });
  if (value === true) {
    if (input.proof === null)
      throw new Error("An achieved Dare v2 has no proof.");
    const targetKeys = new Set(input.proof.targetKeys);
    const payees = input.dare.targets
      .filter((target) => targetKeys.has(target.targetKey))
      .map((target) => {
        if (target.bucksAccountId === null || target.acceptedAt === null) {
          throw new Error(
            `Achieved Dare v2 target ${target.id.toString()} is not accepted.`,
          );
        }
        return {
          id: target.id,
          discordId: target.discordId,
          alias: target.alias,
          bucksAccountId: target.bucksAccountId,
        };
      });
    await payDareV2TargetsInTransaction(tx, { facts, targets: payees });
  } else {
    await refundDareV2ContributionsInTransaction(tx, {
      facts,
      resolution: value === null ? "voided" : "unachieved",
      withCut: value === false,
      ...(value === null ? { voidReason: "missing_evidence" } : {}),
    });
  }
  await recordTerminalDareAnnouncement(tx, input, resolution);
  return resolution;
}
