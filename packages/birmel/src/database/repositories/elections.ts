import { prisma } from "../index.js";
import type { ElectionPoll } from "@prisma/client";

export type CreateElectionInput = {
  guildId: string;
  channelId: string;
  pollType: "election" | "runoff";
  scheduledStart: Date;
  scheduledEnd: Date;
  candidates: string[];
};

export async function createElectionPoll(
  input: CreateElectionInput,
): Promise<ElectionPoll> {
  return prisma.electionPoll.create({
    data: {
      guildId: input.guildId,
      channelId: input.channelId,
      pollType: input.pollType,
      status: "scheduled",
      scheduledStart: input.scheduledStart,
      scheduledEnd: input.scheduledEnd,
      candidates: JSON.stringify(input.candidates),
    },
  });
}

export async function getActiveElection(
  guildId: string,
): Promise<ElectionPoll | null> {
  return prisma.electionPoll.findFirst({
    where: {
      guildId,
      status: { in: ["scheduled", "active"] },
    },
    orderBy: { scheduledStart: "desc" },
  });
}

export async function updateElectionStatus(
  id: number,
  status: string,
  data?: Partial<ElectionPoll>,
): Promise<ElectionPoll> {
  return prisma.electionPoll.update({
    where: { id },
    data: { status, ...data },
  });
}
