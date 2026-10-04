import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import type { Db, ExtendedPrismaClient } from "#src/database/index.ts";

export type SupportSenderThrottleState = {
  inboundAt: Date[];
  uploadAt: Date[];
  lastAlertAt: Date | null;
  lastReceiptAt: Date | null;
  lastFailureNoticeAt: Date | null;
};

const EMPTY_THROTTLE: SupportSenderThrottleState = {
  inboundAt: [],
  uploadAt: [],
  lastAlertAt: null,
  lastReceiptAt: null,
  lastFailureNoticeAt: null,
};

export async function lockSupportSender(
  tx: Db,
  discordId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`support:${discordId}`}))`;
}

export async function readSupportSenderThrottle(
  tx: Db,
  discordId: string,
): Promise<SupportSenderThrottleState> {
  const state = await tx.supportSenderThrottle.findUnique({
    where: { discordId: DiscordAccountIdSchema.parse(discordId) },
    select: {
      inboundAt: true,
      uploadAt: true,
      lastAlertAt: true,
      lastReceiptAt: true,
      lastFailureNoticeAt: true,
    },
  });
  return state ?? EMPTY_THROTTLE;
}

export async function writeSupportSenderThrottle(
  tx: Db,
  discordId: string,
  state: SupportSenderThrottleState,
): Promise<void> {
  const id = DiscordAccountIdSchema.parse(discordId);
  await tx.supportSenderThrottle.upsert({
    where: { discordId: id },
    create: { discordId: id, ...state },
    update: state,
  });
}

export async function claimSupportFailureNotice(
  db: ExtendedPrismaClient,
  discordId: string,
  now = new Date(),
): Promise<boolean> {
  return await db.$transaction(async (tx) => {
    await lockSupportSender(tx, discordId);
    const state = await readSupportSenderThrottle(tx, discordId);
    if (
      state.lastFailureNoticeAt !== null &&
      now.getTime() - state.lastFailureNoticeAt.getTime() < 60_000
    )
      return false;
    await writeSupportSenderThrottle(tx, discordId, {
      ...state,
      lastFailureNoticeAt: now,
    });
    return true;
  });
}
