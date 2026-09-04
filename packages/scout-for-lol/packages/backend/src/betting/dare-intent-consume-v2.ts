import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
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
  DareV2IntentPayloadSchema,
  type DareV2IntentPayload,
} from "#src/betting/dare-intent-v2.ts";
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

type IntentAccount = { id: number } | undefined;

function needsFeature(payload: DareV2IntentPayload): boolean {
  return (
    payload.action === "fund" ||
    payload.action === "accept" ||
    payload.action === "contribute"
  );
}

function needsAccount(payload: DareV2IntentPayload): boolean {
  return (
    payload.action === "fund" ||
    payload.action === "accept" ||
    payload.action === "contribute"
  );
}

async function executeAction(
  tx: Db,
  input: {
    dareId: number;
    revision: number;
    actorDiscordId: DiscordAccountId;
    payload: DareV2IntentPayload;
    account: IntentAccount;
    now: Date;
  },
) {
  const common = {
    dareId: input.dareId,
    revision: input.revision,
    actorDiscordId: input.actorDiscordId,
    now: input.now,
  };
  if (input.payload.action === "fund") {
    if (input.account === undefined)
      throw new Error("Fund intent has no wallet.");
    return await fundDareV2InTransaction(tx, {
      ...common,
      bucksAccountId: input.account.id,
    });
  }
  if (input.payload.action === "accept") {
    if (input.account === undefined)
      throw new Error("Accept intent has no wallet.");
    return await acceptDareV2InTransaction(tx, {
      ...common,
      bucksAccountId: input.account.id,
    });
  }
  if (input.payload.action === "decline") {
    return await declineDareV2InTransaction(tx, common);
  }
  if (input.payload.action === "cancel") {
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

async function consumeClaim(
  input: {
    intent: { id: string; dareId: number; revision: number };
    actorDiscordId: DiscordAccountId;
    payload: DareV2IntentPayload;
    account: IntentAccount;
    now: Date;
  },
  dependencies: DareV2Dependencies,
) {
  return await dependencies.prismaClient.$transaction(async (tx) => {
    const claimed = await tx.bucksDareV2ConfirmationIntent.updateMany({
      where: {
        id: input.intent.id,
        actorDiscordId: input.actorDiscordId,
        consumedAt: null,
        expiresAt: { gt: input.now },
      },
      data: { consumedAt: input.now },
    });
    if (claimed.count !== 1) {
      const current = await tx.bucksDareV2ConfirmationIntent.findUniqueOrThrow({
        where: { id: input.intent.id },
      });
      return current.consumedAt === null
        ? ({ kind: "intent_expired" } as const)
        : ({
            kind: "already_consumed",
            result:
              current.resultJson === null
                ? null
                : JSON.parse(current.resultJson),
          } as const);
    }
    const result = await executeAction(tx, {
      dareId: input.intent.dareId,
      revision: input.intent.revision,
      actorDiscordId: input.actorDiscordId,
      payload: input.payload,
      account: input.account,
      now: input.now,
    });
    await tx.bucksDareV2ConfirmationIntent.update({
      where: { id: input.intent.id },
      data: { resultJson: JSON.stringify(result) },
    });
    return result;
  });
}

async function openingStakeNeeded(
  input: { dareId: number; revision: number },
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
    payload: DareV2IntentPayload;
    intent: { dareId: number; revision: number };
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
    input.payload.action === "contribute"
      ? input.payload.amount
      : input.payload.action === "fund"
        ? await openingStakeNeeded(input.intent, dependencies)
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
  const intent =
    await dependencies.prismaClient.bucksDareV2ConfirmationIntent.findUnique({
      where: { id: input.intentId },
      include: {
        dare: { select: { serverId: true } },
      },
    });
  if (intent?.dare.serverId !== input.serverId) {
    return { kind: "not_found" } as const;
  }
  if (intent.actorDiscordId !== input.actorDiscordId) {
    return { kind: "forbidden" } as const;
  }
  const payload = DareV2IntentPayloadSchema.parse(
    JSON.parse(intent.actionPayload),
  );
  if (intent.action !== payload.action) {
    throw new Error(
      `Dare v2 intent ${intent.id} action does not match its payload.`,
    );
  }
  if (intent.consumedAt !== null) {
    return {
      kind: "already_consumed",
      result: intent.resultJson === null ? null : JSON.parse(intent.resultJson),
    } as const;
  }
  if (intent.expiresAt.getTime() <= now.getTime()) {
    return { kind: "intent_expired" } as const;
  }
  const revision =
    await dependencies.prismaClient.bucksDareV2Revision.findUniqueOrThrow({
      where: {
        dareId_revision: {
          dareId: intent.dareId,
          revision: intent.revision,
        },
      },
      select: { compilerVersion: true },
    });
  if (
    needsFeature(payload) &&
    !(await relationalDareActionEnabled(
      input.serverId,
      revision.compilerVersion,
      payload.action === "fund",
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
    return await consumeClaim(
      {
        intent,
        actorDiscordId: input.actorDiscordId,
        payload,
        account,
        now,
      },
      dependencies,
    );
  } catch (error) {
    return await insufficientOutcome(
      { error, account, payload, intent },
      dependencies,
    );
  }
}
