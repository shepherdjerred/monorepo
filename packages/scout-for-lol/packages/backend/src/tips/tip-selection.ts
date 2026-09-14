import {
  featureTipCooldownHours,
  featureTipPercent,
} from "#src/config/dynamic.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import type { DiscordGuildId } from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import type { FeatureTip } from "#src/tips/tip-catalog.ts";
import { eligibleTips } from "#src/tips/tip-eligibility.ts";
import {
  lastTipShownAt,
  shownTipKeys,
  type TipAudience,
} from "#src/tips/tip-state.ts";

const MS_PER_HOUR = 3_600_000;

/**
 * The three reads selection makes, as functions rather than a database client.
 *
 * Production binds them to Prisma; a test supplies plain functions. That keeps
 * the control flow here — flag, cooldown, roll, eligibility — testable without
 * standing up a database or faking a Prisma client's shape.
 */
export type TipReaders = {
  lastShownAt: (audience: TipAudience) => Promise<Date | undefined>;
  shownTipKeys: (audience: TipAudience) => Promise<Set<string>>;
  eligibleTips: (input: {
    serverId: DiscordGuildId;
    alreadyShown: ReadonlySet<string>;
  }) => Promise<FeatureTip[]>;
};

export type TipSelectionDeps = {
  /** Injected so the percentage roll is deterministic under test. */
  random?: () => number;
  now?: Date;
  db?: ExtendedPrismaClient;
  readers?: TipReaders;
};

function prismaReaders(db: ExtendedPrismaClient | undefined): TipReaders {
  return {
    lastShownAt: async (audience) => await lastTipShownAt(audience, db),
    shownTipKeys: async (audience) => await shownTipKeys(audience, db),
    eligibleTips: async (input) =>
      await eligibleTips({
        ...input,
        ...(db === undefined ? {} : { db }),
      }),
  };
}

/**
 * The tip to append to one message, or undefined.
 *
 * Four gates, cheapest first, and every one of them must pass:
 * the flag is on for the guild, the audience is out of its cooldown, the
 * percentage roll lands, and some available feature is still unused. The roll
 * sits before the database work so an ordinary message costs one flag read.
 */
export async function selectTip(
  audience: TipAudience,
  deps: TipSelectionDeps = {},
): Promise<FeatureTip | undefined> {
  const enabled = await isPolicyEnabled("feature_tips_enabled", {
    server: audience.serverId,
    ...(audience.discordId === undefined ? {} : { user: audience.discordId }),
  });
  if (!enabled) return undefined;

  const percent = featureTipPercent();
  if (percent <= 0) return undefined;
  const random = deps.random ?? Math.random;
  if (random() * 100 >= percent) return undefined;

  const readers = deps.readers ?? prismaReaders(deps.db);
  const now = deps.now ?? new Date();
  const lastShown = await readers.lastShownAt(audience);
  if (
    lastShown !== undefined &&
    now.getTime() - lastShown.getTime() <
      featureTipCooldownHours() * MS_PER_HOUR
  ) {
    return undefined;
  }

  const candidates = await readers.eligibleTips({
    serverId: audience.serverId,
    alreadyShown: await readers.shownTipKeys(audience),
  });
  if (candidates.length === 0) return undefined;
  // Catalog order is the priority order, so the most broadly useful unused
  // feature is offered first rather than a random one.
  return candidates[0];
}
