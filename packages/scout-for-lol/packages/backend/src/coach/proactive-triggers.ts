import {
  COACH_PROACTIVE_LIMITS,
  type CoachLiveContext,
  type CoachTrigger,
  type CoachTriggerKind,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import type { Db } from "#src/database/index.ts";

/**
 * The server's half of a proactive coach turn (`coach/triggers`), after
 * `coach/proactive-policy.ts` has admitted the environment and the flags.
 *
 * The client's detectors decide when to ask; the server decides whether the
 * ask is honest and whether it is one too many:
 *
 * - the evidence must agree with the snapshot it came with, so a trigger can
 *   only name what the scoreboard shows;
 * - the server words the question from that evidence, so the turn carries no
 *   client text;
 * - admitted triggers are spaced at least 90 seconds apart per owner, at most
 *   10 per game per owner, and the same event is admitted once. Each admitted
 *   trigger writes a `ScoutCoachTriggerReceipt` in the transaction that
 *   reserves its run, under a per-owner advisory lock, so concurrent asks
 *   cannot both pass.
 */

/** What makes two triggers of one kind in one game the same event. */
export function triggerWindowKey(trigger: CoachTrigger): string {
  switch (trigger.kind) {
    case "enemy_item_spike":
      return `${trigger.champion}:${trigger.itemId.toString()}`;
    case "enemy_fed":
      return trigger.champion;
    case "damage_profile_shift":
      return trigger.to;
    case "healing_threat":
      return "enemy_team";
    case "death_streak":
      return trigger.deaths.toString();
  }
}

/**
 * Why the evidence does not match its snapshot, or null when it does. A
 * mismatch is a broken or dishonest client: the route answers a typed 400.
 */
export function triggerEvidenceIssue(
  trigger: CoachTrigger,
  snapshot: CoachLiveContext,
): string | null {
  const self = snapshot.participants.find((player) => player.isSelf);
  if (self === undefined) return "the snapshot has no local player";
  const enemies = snapshot.participants.filter(
    (player) => player.team !== self.team,
  );
  switch (trigger.kind) {
    case "enemy_item_spike": {
      const enemy = enemies.find(
        (player) => player.champion === trigger.champion,
      );
      if (enemy === undefined) return "the champion is not an enemy";
      return enemy.items.some(
        (item) =>
          item.itemId === trigger.itemId && item.name === trigger.itemName,
      )
        ? null
        : "the enemy does not hold the item";
    }
    case "enemy_fed": {
      const enemy = enemies.find(
        (player) =>
          player.champion === trigger.champion &&
          player.kills === trigger.kills &&
          player.deaths === trigger.deaths &&
          player.assists === trigger.assists,
      );
      return enemy === undefined
        ? "no enemy has that champion and score"
        : null;
    }
    case "damage_profile_shift":
      return trigger.from === trigger.to
        ? "a shift names two different profiles"
        : null;
    case "healing_threat":
      return null;
    case "death_streak":
      if (self.deaths !== trigger.deaths) {
        return "the player's deaths do not match";
      }
      return trigger.deathsWithoutTakedown > trigger.deaths
        ? "the streak is longer than the player's deaths"
        : null;
  }
}

/**
 * Every proactive question begins with this, and no other turn's question
 * the server words does. The agent offers the `coach-proactive` skill on a
 * turn whose question starts with it (`explore/agent.ts`).
 */
export const PROACTIVE_QUESTION_PREFIX = "Scout noticed";

export function isProactiveTriggerQuestion(question: string): boolean {
  return question.startsWith(`${PROACTIVE_QUESTION_PREFIX} `);
}

const PROFILE_WORDS = {
  physical: "physical",
  magic: "magic",
  mixed: "mixed physical and magic",
} as const;

/**
 * The question the transcript shows for a proactive turn. Every name in it
 * is one the evidence check found on the snapshot's scoreboard.
 */
export function proactiveTriggerQuestion(trigger: CoachTrigger): string {
  const ask = "What, if anything, should I consider?";
  switch (trigger.kind) {
    case "enemy_item_spike":
      return `${PROACTIVE_QUESTION_PREFIX} the enemy ${trigger.champion} completed ${trigger.itemName}. ${ask}`;
    case "enemy_fed":
      return `${PROACTIVE_QUESTION_PREFIX} the enemy ${trigger.champion} is ${trigger.kills.toString()}/${trigger.deaths.toString()}/${trigger.assists.toString()}. ${ask}`;
    case "damage_profile_shift":
      return `${PROACTIVE_QUESTION_PREFIX} the enemy team's damage shifted from ${PROFILE_WORDS[trigger.from]} to ${PROFILE_WORDS[trigger.to]}. ${ask}`;
    case "healing_threat":
      return `${PROACTIVE_QUESTION_PREFIX} the enemy team has ${trigger.healingItems.toString()} healing items and I have no anti-heal. ${ask}`;
    case "death_streak":
      return `${PROACTIVE_QUESTION_PREFIX} I died ${trigger.deathsWithoutTakedown.toString()} times without a takedown. ${ask}`;
  }
}

/** The trigger a proactive turn's audit row admits, by kind and window. */
export type ProactiveTriggerRecord = {
  readonly kind: CoachTriggerKind;
  readonly windowKey: string;
};

export type ProactiveTriggerRefusal =
  | { readonly kind: "duplicate" }
  | { readonly kind: "game_cap"; readonly limit: number }
  | { readonly kind: "spacing"; readonly retryAfterSeconds: number };

/** Thrown inside the run's transaction, so the refused run is never reserved. */
export class ProactiveTriggerRefusedError extends Error {
  constructor(readonly refusal: ProactiveTriggerRefusal) {
    super(`proactive trigger refused: ${refusal.kind}`);
    this.name = "ProactiveTriggerRefusedError";
  }
}

/** What admission reads and writes; Prisma in production, a fake in tests. */
export type ProactiveReceiptStore = {
  /** Serialise admission for one owner until the transaction ends. */
  readonly lockOwner: (ownerId: DiscordAccountId) => Promise<void>;
  readonly windowTaken: (input: {
    readonly ownerId: DiscordAccountId;
    readonly gameKey: string;
    readonly trigger: ProactiveTriggerRecord;
  }) => Promise<boolean>;
  readonly admittedForGame: (input: {
    readonly ownerId: DiscordAccountId;
    readonly gameKey: string;
  }) => Promise<number>;
  readonly lastAdmittedAt: (ownerId: DiscordAccountId) => Promise<Date | null>;
  readonly record: (receipt: {
    readonly ownerId: DiscordAccountId;
    readonly deviceId: string;
    readonly gameKey: string;
    readonly trigger: ProactiveTriggerRecord;
    readonly runId: string;
    readonly createdAt: Date;
  }) => Promise<void>;
};

/**
 * Admit one trigger or throw `ProactiveTriggerRefusedError`. The same event
 * is checked first, so a retry of an admitted trigger reads as a duplicate
 * rather than as too soon.
 */
export async function admitProactiveTrigger(
  store: ProactiveReceiptStore,
  input: {
    readonly ownerId: DiscordAccountId;
    readonly deviceId: string;
    readonly gameKey: string;
    readonly trigger: ProactiveTriggerRecord;
    readonly runId: string;
    readonly now: Date;
  },
): Promise<void> {
  const { ownerId, gameKey, trigger } = input;
  await store.lockOwner(ownerId);
  if (await store.windowTaken({ ownerId, gameKey, trigger })) {
    throw new ProactiveTriggerRefusedError({ kind: "duplicate" });
  }
  if (
    (await store.admittedForGame({ ownerId, gameKey })) >=
    COACH_PROACTIVE_LIMITS.perGame
  ) {
    throw new ProactiveTriggerRefusedError({
      kind: "game_cap",
      limit: COACH_PROACTIVE_LIMITS.perGame,
    });
  }
  const last = await store.lastAdmittedAt(ownerId);
  if (last !== null) {
    const elapsedMs = input.now.getTime() - last.getTime();
    const spacingMs = COACH_PROACTIVE_LIMITS.spacingSeconds * 1000;
    if (elapsedMs < spacingMs) {
      throw new ProactiveTriggerRefusedError({
        kind: "spacing",
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((spacingMs - elapsedMs) / 1000),
        ),
      });
    }
  }
  await store.record({ ...input, createdAt: input.now });
}

/** The receipt store over a Prisma transaction. */
export function prismaReceiptStore(
  client: Pick<Db, "scoutCoachTriggerReceipt" | "$executeRaw">,
): ProactiveReceiptStore {
  return {
    lockOwner: async (ownerId) => {
      await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('scout-coach-proactive'), hashtext(${ownerId}))`;
    },
    windowTaken: async ({ ownerId, gameKey, trigger }) =>
      (await client.scoutCoachTriggerReceipt.count({
        where: {
          ownerId,
          gameKey,
          kind: trigger.kind,
          windowKey: trigger.windowKey,
        },
      })) > 0,
    admittedForGame: async ({ ownerId, gameKey }) =>
      await client.scoutCoachTriggerReceipt.count({
        where: { ownerId, gameKey },
      }),
    lastAdmittedAt: async (ownerId) => {
      const last = await client.scoutCoachTriggerReceipt.findFirst({
        where: { ownerId },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      return last?.createdAt ?? null;
    },
    record: async (receipt) => {
      await client.scoutCoachTriggerReceipt.create({
        data: {
          ownerId: receipt.ownerId,
          deviceId: receipt.deviceId,
          gameKey: receipt.gameKey,
          kind: receipt.trigger.kind,
          windowKey: receipt.trigger.windowKey,
          runId: receipt.runId,
          createdAt: receipt.createdAt,
        },
      });
    },
  };
}
