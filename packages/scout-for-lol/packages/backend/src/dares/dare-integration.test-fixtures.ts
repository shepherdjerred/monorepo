import type { FlagName } from "#src/configuration/flags.ts";
import { createDareDraft } from "#src/dares/lifecycle/dare-draft.ts";
import { consumeDareConfirmationIntent } from "#src/dares/lifecycle/dare-intent-consume.ts";
import { createDareConfirmationIntent } from "#src/dares/lifecycle/dare-intent.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  DareContractSchema,
  type DareDeadlineSpec,
  type DareTargetBinding,
  type DiscordAccountId,
  type DiscordChannelId,
  type DiscordGuildId,
} from "@scout-for-lol/data";

/**
 * Shared support for the Dare integration suites.
 *
 * The suites keep the real SQL compiler and stub only lake execution, so each
 * test decides what the contract's evidence is while everything from the
 * evidence down — finality, notifications, callouts — runs for real.
 */

export const ONE_WIN_SQL =
  "SELECT COUNT(*) >= 1 AS achieved FROM T1 p WHERE p.win";

/** Every Dare-owned row, children first. */
export async function clearDareTables(db: ExtendedPrismaClient): Promise<void> {
  await db.matchNotificationIntent.deleteMany();
  await db.confirmationIntent.deleteMany();
  await db.dareEvidence.deleteMany();
  await db.dareTarget.deleteMany();
  await db.dareRevision.deleteMany();
  await db.dare.deleteMany();
}

/**
 * Freeze an active contract as monotone, so a satisfied match settles it
 * immediately rather than at its deadline.
 */
export async function freezeDareAsMonotone(
  db: ExtendedPrismaClient,
  dareId: number,
): Promise<void> {
  const active = await db.dare.findUniqueOrThrow({
    where: { id: dareId },
    select: { contractJson: true },
  });
  if (active.contractJson === null) throw new Error("Dare is not active.");
  const contract = DareContractSchema.parse(JSON.parse(active.contractJson));
  await db.dare.update({
    where: { id: dareId },
    data: {
      contractJson: JSON.stringify({ ...contract, finality: "monotone_true" }),
    },
  });
}

type DareIntentAction = "publish" | "accept" | "decline" | "cancel";

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
      Promise.resolve(name === "dares_enabled"),
  };

  function definition(
    input: {
      queryText?: string | undefined;
      targets?: DareTargetBinding[] | undefined;
      deadlineSpec?: DareDeadlineSpec | undefined;
      originalText?: string | undefined;
    } = {},
  ) {
    return {
      originalText:
        input.originalText ?? "I dare Virmel to win a game on Twisted Fate",
      queryText: input.queryText ?? ONE_WIN_SQL,
      plainLanguage: "Virmel wins at least one eligible game.",
      targets: input.targets ?? [config.targetBinding],
      deadlineSpec: input.deadlineSpec ?? { kind: "relative", days: 7 },
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

  async function publish(dareId: number, key: string): Promise<void> {
    const published = await consume(
      await intent({
        dareId,
        actor: config.challenger,
        action: "publish",
        key,
      }),
      config.challenger,
    );
    if (published.kind !== "published")
      throw new Error(`Expected published Dare, got ${published.kind}.`);
  }

  async function activate(dareId: number, key: string): Promise<void> {
    await publish(dareId, `publish-${key}`);
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
    intent,
    consume,
    publish,
    activate,
  };
}
