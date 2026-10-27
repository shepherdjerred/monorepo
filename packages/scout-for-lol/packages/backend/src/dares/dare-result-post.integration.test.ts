import {
  dareSqlContractCore,
  dareTargetBinding,
  loadRiftFixture,
  targetMatchAt,
} from "#src/dares/dare-test-fixtures.ts";
import { notificationIntentRowToRecord } from "#src/database/durable/intent-row.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testChannelId, testGuildId } from "#src/testing/test-ids.ts";
import {
  DareContractSchema,
  DiscordAccountIdSchema,
  PlayerIdSchema,
  type DareContract,
  type RawMatch,
} from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * The public result post a resolved Dare makes in its own channel.
 *
 * The contract's SQL evidence is stubbed; everything from the capture entry
 * down to the minted intent is real, and the message is rendered from the
 * stored intent exactly as the notification Workflow would.
 */

const { prisma: db } = createTestDatabase("dare-result-post");
const SERVER = testGuildId("941");
const CHANNEL = testChannelId("942");
const CHALLENGER = DiscordAccountIdSchema.parse("100000000000000940");
const TARGET = DiscordAccountIdSchema.parse("100000000000000941");
const HASH = "c".repeat(64);
const T0 = new Date("2026-09-01T12:00:00.000Z");
const MATCH_ID = RiotMatchIdSchema.parse("NA1_7100000041");

// Every execution resolves the Dare unachieved on this match: the one-game
// cap is reached.
vi.mock("#src/dares/sql/dare-sql.ts", async () => {
  const { finalUnachievedDareSqlModule } =
    await import("#src/dares/dare-test-fixtures.ts");
  return finalUnachievedDareSqlModule({
    matchId: MATCH_ID,
    queryHash: HASH,
  });
});

const { captureDareSqlForMatch } =
  await import("#src/dares/settlement/dare-settle-contract.ts");
const { buildDareStatusNotificationMessage } =
  await import("#src/temporal/notification/dare-status-notification.ts");

function contract(): DareContract {
  return DareContractSchema.parse({
    ...dareSqlContractCore({ queryHash: HASH, maxEligibleGames: 1 }),
    activation: { kind: "immediate" },
    activationSnapshot: null,
    originalText: "I bet Virmel cannot win on Twisted Fate",
    plainLanguage: "Virmel wins a game on Twisted Fate",
    targets: [dareTargetBinding(TARGET)],
    serverId: SERVER,
    channelId: CHANNEL,
    revision: 1,
    activationAt: T0.toISOString(),
    deadlineAt: new Date(T0.getTime() + 7 * 86_400_000).toISOString(),
    deadlineSpec: { kind: "relative", days: 7 },
  });
}

beforeEach(async () => {
  await db.matchNotificationIntent.deleteMany();
  await db.dareEvidence.deleteMany();
  await db.dareTarget.deleteMany();
  await db.dare.deleteMany();
});

/** An active Dare accepted by its target. */
async function acceptedActiveDare() {
  const parsed = contract();
  const dare = await db.dare.create({
    data: {
      serverId: SERVER,
      channelId: CHANNEL,
      challengerDiscordId: CHALLENGER,
      dareState: "active",
      currentRevision: 1,
      publishedRevision: 1,
      contractJson: JSON.stringify(parsed),
      activatedAt: T0,
      deadlineAt: new Date(T0.getTime() + 7 * 86_400_000),
      targets: {
        create: [
          {
            targetKey: "T1",
            discordId: TARGET,
            playerId: PlayerIdSchema.parse(1),
            alias: "Virmel",
            accounts: JSON.stringify(parsed.targets[0]?.accounts ?? []),
            acceptedAt: T0,
          },
        ],
      },
    },
    include: { targets: true },
  });
  return { dare, contract: parsed };
}

async function qualifyingMatch(): Promise<RawMatch> {
  return targetMatchAt(
    await loadRiftFixture(),
    MATCH_ID,
    new Date(T0.getTime() + 60 * 60 * 1000),
    10,
  );
}

async function resultPosts(dareId: number) {
  return await db.matchNotificationIntent.findMany({
    where: {
      subjectKind: "dare",
      subjectId: dareId.toString(),
      targetKind: "channel",
    },
  });
}

describe("the Dare result post", () => {
  test("a resolved Dare owes its own channel one post naming the verified result", async () => {
    const { dare, contract: parsed } = await acceptedActiveDare();

    const summary = await captureDareSqlForMatch({
      dare,
      contract: parsed,
      matchData: await qualifyingMatch(),
      prismaClient: db,
      now: new Date(T0.getTime() + 2 * 60 * 60 * 1000),
      notify: "enqueue",
    });
    expect(summary?.resolution).toBe("unachieved");

    const rows = await resultPosts(dare.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetId).toBe(CHANNEL);

    const record = notificationIntentRowToRecord(rows[0]);
    if (!("dareId" in record)) throw new Error("expected a Dare subject");
    const message = buildDareStatusNotificationMessage(record);
    expect(message.content).toContain(
      `**Scout Dare #${dare.id.toString()}: 🛡️ NOT ACHIEVED**`,
    );
    expect(message.content).toContain("Virmel wins a game on Twisted Fate");
    // An unsuccessful Dare has no winners to mention.
    expect(message.allowedMentions).toEqual({
      parse: [],
      users: [],
    });

    // Each participant's DM is still written beside the public post.
    expect(
      await db.matchNotificationIntent.count({
        where: {
          subjectKind: "dare",
          subjectId: dare.id.toString(),
          targetKind: "dm",
        },
      }),
    ).toBeGreaterThan(0);
  });

  test("a match owed no public delivery writes no result post", async () => {
    const { dare, contract: parsed } = await acceptedActiveDare();

    await captureDareSqlForMatch({
      dare,
      contract: parsed,
      matchData: await qualifyingMatch(),
      prismaClient: db,
      now: new Date(T0.getTime() + 2 * 60 * 60 * 1000),
      notify: "withhold",
    });

    expect(await resultPosts(dare.id)).toEqual([]);
  });
});
