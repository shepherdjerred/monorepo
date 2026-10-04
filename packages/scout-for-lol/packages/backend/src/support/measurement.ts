import { z } from "zod";
import { prisma } from "#src/database/index.ts";
import { SCOUT_OPERATOR_IDS } from "#src/operations/operator-allowlist.ts";
import { Prisma } from "#generated/prisma/client/index.js";

export async function recordSupportTouchpoint(
  id: string,
  surface: "REPORT" | "HELP",
  action: "DELIVERED" | "OPENED" | "SUBMITTED",
) {
  await prisma.supportTouchpoint.createMany({
    data: { id, surface, action },
    skipDuplicates: true,
  });
}

export async function supportStats() {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60_000);
  const [contributors, labelled, touchpoints, failures, response] =
    await Promise.all([
      prisma.supportConversation.count({
        where: {
          discordId: { notIn: [...SCOUT_OPERATOR_IDS] },
          messages: {
            some: { direction: "INBOUND", createdAt: { gte: since } },
          },
        },
      }),
      prisma.supportConversation.groupBy({
        by: ["category"],
        where: {
          discordId: { notIn: [...SCOUT_OPERATOR_IDS] },
          messages: {
            some: { direction: "INBOUND", createdAt: { gte: since } },
          },
        },
        _count: true,
      }),
      prisma.supportTouchpoint.groupBy({
        by: ["surface", "action"],
        where: { createdAt: { gte: since } },
        _count: true,
      }),
      prisma.supportJob.count({
        where: {
          kind: { in: ["REPLY", "ALERT"] },
          status: { in: ["BLOCKED", "UNKNOWN", "FAILED"] },
          createdAt: { gte: since },
          conversation: { discordId: { notIn: [...SCOUT_OPERATOR_IDS] } },
        },
      }),
      prisma.$queryRaw`SELECT avg(EXTRACT(EPOCH FROM (first_reply - first_message)))::double precision AS seconds
      FROM (SELECT "conversationId", min("createdAt") FILTER (WHERE direction = 'INBOUND') AS first_message,
        min("createdAt") FILTER (WHERE direction = 'OUTBOUND') AS first_reply
        FROM "Feedback" WHERE "discordId" NOT IN (${Prisma.join([...SCOUT_OPERATOR_IDS])}) GROUP BY "conversationId") t
      WHERE first_message >= ${since} AND first_reply >= first_message`,
    ]);
  const parsed = z
    .array(z.object({ seconds: z.number().nullable() }))
    .parse(response);
  return {
    contributors,
    labelled,
    touchpoints,
    deliveryFailures: failures,
    averageFirstResponseSeconds: parsed[0]?.seconds ?? null,
  };
}
