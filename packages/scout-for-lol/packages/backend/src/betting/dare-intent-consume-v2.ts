import {
  ConfirmationIntentPayloadSchema,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type ConfirmationIntentPayload,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { ensureBucksAccount } from "#src/betting/accounts.ts";
import { contributeToDareV2InTransaction } from "#src/betting/dare-contribute-v2.ts";
import {
  acceptDareV2InTransaction,
  fundDareV2InTransaction,
} from "#src/betting/dare-fund-consent-v2.ts";
import {
  cancelDareV2InTransaction,
  declineDareV2InTransaction,
} from "#src/betting/dare-refund-v2.ts";
import {
  defaultDareV2Dependencies,
  relationalDareActionEnabled,
  type DareV2Dependencies,
} from "#src/betting/dare-v2-common.ts";
import { InsufficientBucksError } from "#src/betting/ledger.ts";
import type { Db } from "#src/database/index.ts";
import type { ConfirmationIntent } from "#generated/prisma/client/index.js";
import { claimAndExecute } from "#src/lib/confirmation-intent/claim.ts";

type IntentAccount = { id: number } | undefined;

/** The dare an intent acts on, together with the revision it was minted for. */
type DareIntentTarget = { dareId: number; revision: number };

function needsFeature(payload: ConfirmationIntentPayload): boolean {
  return (
    payload.kind === "dare_fund" ||
    payload.kind === "dare_accept" ||
    payload.kind === "dare_contribute"
  );
}

function needsAccount(payload: ConfirmationIntentPayload): boolean {
  return (
    payload.kind === "dare_fund" ||
    payload.kind === "dare_accept" ||
    payload.kind === "dare_contribute"
  );
}

/**
 * A dare intent always carries its dare and revision; the columns are nullable
 * only because an intent need not act on an existing row. Missing values here
 * mean a broken caller contract, so they are let through as an error rather
 * than defaulted.
 */
function dareTarget(intent: ConfirmationIntent): DareIntentTarget {
  if (intent.dareId === null || intent.expectedRevision === null) {
    throw new Error(
      `Confirmation intent ${intent.id} of kind ${intent.kind} has no dare target.`,
    );
  }
  return { dareId: intent.dareId, revision: intent.expectedRevision };
}

async function executeAction(
  tx: Db,
  input: {
    target: DareIntentTarget;
    actorDiscordId: DiscordAccountId;
    payload: ConfirmationIntentPayload;
    account: IntentAccount;
    now: Date;
  },
) {
  const common = {
    dareId: input.target.dareId,
    revision: input.target.revision,
    actorDiscordId: input.actorDiscordId,
    now: input.now,
  };
  if (input.payload.kind === "dare_fund") {
    if (input.account === undefined)
      throw new Error("Fund intent has no wallet.");
    return await fundDareV2InTransaction(tx, {
      ...common,
      bucksAccountId: input.account.id,
    });
  }
  if (input.payload.kind === "dare_accept") {
    if (input.account === undefined)
      throw new Error("Accept intent has no wallet.");
    return await acceptDareV2InTransaction(tx, {
      ...common,
      bucksAccountId: input.account.id,
    });
  }
  if (input.payload.kind === "dare_decline") {
    return await declineDareV2InTransaction(tx, common);
  }
  if (input.payload.kind === "dare_cancel") {
    return await cancelDareV2InTransaction(tx, common);
  }
  if (input.account === undefined)
    throw new Error("Contribution intent has no wallet.");
  return await contributeToDareV2InTransaction(tx, {
    ...common,
    bucksAccountId: input.account.id,
    amount: input.payload.amount,
  });
}

async function openingStakeNeeded(
  input: DareIntentTarget,
  dependencies: DareV2Dependencies,
): Promise<number> {
  const revision =
    await dependencies.prismaClient.bucksDareV2Revision.findUniqueOrThrow({
      where: {
        dareId_revision: {
          dareId: input.dareId,
          revision: input.revision,
        },
      },
      select: { openingStake: true },
    });
  return revision.openingStake;
}

async function insufficientOutcome(
  input: {
    error: unknown;
    account: IntentAccount;
    payload: ConfirmationIntentPayload;
    target: DareIntentTarget;
  },
  dependencies: DareV2Dependencies,
) {
  if (
    input.account === undefined ||
    !(input.error instanceof InsufficientBucksError)
  ) {
    throw input.error;
  }
  const current =
    await dependencies.prismaClient.bucksAccount.findUniqueOrThrow({
      where: { id: input.account.id },
      select: { balance: true },
    });
  const needed =
    input.payload.kind === "dare_contribute"
      ? input.payload.amount
      : input.payload.kind === "dare_fund"
        ? await openingStakeNeeded(input.target, dependencies)
        : undefined;
  return { kind: "insufficient", balance: current.balance, needed } as const;
}

export async function consumeDareV2ConfirmationIntent(
  input: {
    intentId: string;
    serverId: DiscordGuildId;
    actorDiscordId: DiscordAccountId;
  },
  dependencies: DareV2Dependencies = defaultDareV2Dependencies,
  now: Date = new Date(),
) {
  const intent = await dependencies.prismaClient.confirmationIntent.findUnique({
    where: { id: input.intentId },
  });
  // The guild is stored on the intent, so this is the same check the join
  // through `dare.serverId` used to make.
  if (intent?.serverId !== input.serverId) {
    return { kind: "not_found" } as const;
  }
  if (intent.actorDiscordId !== input.actorDiscordId) {
    return { kind: "forbidden" } as const;
  }
  const payload = ConfirmationIntentPayloadSchema.parse(
    JSON.parse(intent.payload),
  );
  if (intent.consumedAt !== null) {
    return {
      kind: "already_consumed",
      result: intent.resultJson === null ? null : JSON.parse(intent.resultJson),
    } as const;
  }
  if (intent.expiresAt.getTime() <= now.getTime()) {
    return { kind: "intent_expired" } as const;
  }
  const target = dareTarget(intent);
  const revision =
    await dependencies.prismaClient.bucksDareV2Revision.findUniqueOrThrow({
      where: {
        dareId_revision: {
          dareId: target.dareId,
          revision: target.revision,
        },
      },
      select: { compilerVersion: true },
    });
  if (
    needsFeature(payload) &&
    !(await relationalDareActionEnabled(
      input.serverId,
      revision.compilerVersion,
      payload.kind === "dare_fund",
      dependencies,
    ))
  ) {
    return { kind: "feature_disabled" } as const;
  }
  const account = needsAccount(payload)
    ? await ensureBucksAccount(
        {
          serverId: DiscordGuildIdSchema.parse(input.serverId),
          discordId: DiscordAccountIdSchema.parse(input.actorDiscordId),
        },
        dependencies.prismaClient,
      )
    : undefined;
  try {
    return await claimAndExecute(
      dependencies.prismaClient,
      {
        intentId: intent.id,
        actorDiscordId: input.actorDiscordId,
        now,
      },
      async (tx) =>
        await executeAction(tx, {
          target,
          actorDiscordId: input.actorDiscordId,
          payload,
          account,
          now,
        }),
    );
  } catch (error) {
    return await insufficientOutcome(
      { error, account, payload, target },
      dependencies,
    );
  }
}
