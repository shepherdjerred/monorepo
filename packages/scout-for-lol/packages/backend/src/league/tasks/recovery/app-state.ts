import { prisma } from "@scout-for-lol/backend/database/index.ts";

const BOT_STATE_ID = 1;

export async function getLastSuccessfulPollAt(): Promise<Date | undefined> {
  const row = await prisma.botState.findUnique({
    where: { id: BOT_STATE_ID },
  });
  return row?.lastSuccessfulPollAt ?? undefined;
}

export async function setLastSuccessfulPollAt(date: Date): Promise<void> {
  await prisma.botState.upsert({
    where: { id: BOT_STATE_ID },
    update: { lastSuccessfulPollAt: date },
    create: { id: BOT_STATE_ID, lastSuccessfulPollAt: date },
  });
}
