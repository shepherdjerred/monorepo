import {
  DareContractSchema,
  StorableDarePileOnSchema,
  type DareDeadlineSpec,
  type DareTargetBinding,
  type DiscordAccountId,
  type DiscordChannelId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { createDareDraft } from "#src/betting/dares/lifecycle/dare-draft.ts";
import { createDareConfirmationIntent } from "#src/betting/dares/lifecycle/dare-intent.ts";
import { consumeDareConfirmationIntent } from "#src/betting/dares/lifecycle/dare-intent-consume.ts";
import type { FlagName } from "#src/configuration/flags.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

/**
 * Shared support for the Dare integration suites.
 *
 * The suites keep the real SQL compiler and stub only lake execution, so each
 * test decides what the contract's evidence is while everything from the
 * evidence down — finality, money, notifications, callouts — runs for real.
 */

export const ONE_WIN_SQL =
  "SELECT COUNT(*) >= 1 AS achieved FROM T1 p WHERE p.win";

/** Every Dare-owned row, children first. */
export async function clearDareTables(db: ExtendedPrismaClient): Promise<void> {
  await db.matchNotificationIntent.deleteMany();
  await db.confirmationIntent.deleteMany();
  await db.bucksDareEvidence.deleteMany();
  await db.bucksDareContribution.deleteMany();
  await db.bucksDareTarget.deleteMany();
  await db.bucksDareRevision.deleteMany();
  await db.bucksDare.deleteMany();
  await db.bucksLedgerEntry.deleteMany();
  await db.bucksAccount.deleteMany();
}

/**
 * Freeze an active contract as monotone, so a satisfied match settles it
 * immediately rather than at its deadline.
 */
export async function freezeDareAsMonotone(
  db: ExtendedPrismaClient,
  dareId: number,
): Promise<void> {
  const active = await db.bucksDare.findUniqueOrThrow({
    where: { id: dareId },
    select: { contractJson: true },
  });
  if (active.contractJson === null) throw new Error("Dare is not active.");
  const contract = DareContractSchema.parse(JSON.parse(active.contractJson));
  await db.bucksDare.update({
    where: { id: dareId },
    data: {
      contractJson: JSON.stringify({ ...contract, finality: "monotone_true" }),
    },
  });
}

type DareIntentAction = "fund" | "accept" | "decline" | "cancel";

/** A contribution payload for `amount` Bucks. */
export function contribute(amount: number) {
  return {
    kind: "dare_contribute" as const,
    amount: StorableDarePileOnSchema.parse(amount),
  };
}

/**
 * The challenger's and target's lifecycle actions, through the real draft,
 * confirmation-intent, and consume paths.
 */
export function createDareLifecycleHarness(config: {
  db: ExtendedPrismaClient;
  serverId: DiscordGuildId;
  channelId: DiscordChannelId;
  challenger: DiscordAccountId;
  target: DiscordAccountId;
  targetBinding: DareTargetBinding;
  now: Date;
}) {
  const deps = {
    prismaClient: config.db,
    isPolicyEnabled: (name: FlagName) =>
      Promise.resolve(
        name === "betting_enabled" || name === "bucks_dares_enabled",
      ),
  };

  function definition(
    input: {
      queryText?: string | undefined;
      targets?: DareTargetBinding[] | undefined;
      deadlineSpec?: DareDeadlineSpec | undefined;
      openingStake?: number | undefined;
      originalText?: string | undefined;
    } = {},
  ) {
    return {
      originalText:
        input.originalText ?? "I bet Virmel can't win a game on Twisted Fate",
      queryText: input.queryText ?? ONE_WIN_SQL,
      plainLanguage: "Virmel wins at least one eligible game.",
      targets: input.targets ?? [config.targetBinding],
      deadlineSpec: input.deadlineSpec ?? { kind: "relative", days: 7 },
      openingStake: input.openingStake ?? 20,
    };
  }

  async function makeDraft(
    input: Parameters<typeof definition>[0] = {},
  ): Promise<number> {
    const result = await createDareDraft(
      {
        ...definition(input),
        serverId: config.serverId,
        channelId: config.channelId,
        challengerDiscordId: config.challenger,
      },
      deps,
      config.now,
    );
    if (result.kind !== "created")
      throw new Error(`Expected Dare draft creation, got ${result.kind}.`);
    return result.dareId;
  }

  async function intent(input: {
    dareId: number;
    actor: DiscordAccountId;
    action: DareIntentAction;
    key: string;
  }): Promise<string> {
    const result = await createDareConfirmationIntent(
      {
        dareId: input.dareId,
        serverId: config.serverId,
        actorDiscordId: input.actor,
        expectedRevision: 1,
        payload: { kind: `dare_${input.action}` },
        idempotencyKey: input.key,
      },
      deps,
      config.now,
    );
    if (result.kind !== "intent_created")
      throw new Error("Expected confirmation intent.");
    return result.intentId;
  }

  async function consume(intentId: string, actor: DiscordAccountId) {
    return await consumeDareConfirmationIntent(
      { intentId, serverId: config.serverId, actorDiscordId: actor },
      deps,
      config.now,
    );
  }

  async function makeContribution(
    dareId: number,
    actor: DiscordAccountId,
    amount: number,
    key: string,
  ): Promise<void> {
    const result = await createDareConfirmationIntent(
      {
        dareId,
        serverId: config.serverId,
        actorDiscordId: actor,
        expectedRevision: 1,
        payload: contribute(amount),
        idempotencyKey: key,
      },
      deps,
      config.now,
    );
    if (result.kind !== "intent_created") {
      throw new Error("Expected contribution intent.");
    }
    await consume(result.intentId, actor);
  }

  async function fund(dareId: number, key: string): Promise<void> {
    const funded = await consume(
      await intent({ dareId, actor: config.challenger, action: "fund", key }),
      config.challenger,
    );
    if (funded.kind !== "funded")
      throw new Error(`Expected funded Dare, got ${funded.kind}.`);
  }

  async function activate(dareId: number, key: string): Promise<void> {
    await fund(dareId, `fund-${key}`);
    const accepted = await consume(
      await intent({
        dareId,
        actor: config.target,
        action: "accept",
        key: `accept-${key}`,
      }),
      config.target,
    );
    if (accepted.kind !== "accepted" || !accepted.activated) {
      throw new Error("Expected active Dare.");
    }
  }

  return {
    deps,
    definition,
    makeDraft,
    contribute,
    intent,
    consume,
    makeContribution,
    fund,
    activate,
  };
}
