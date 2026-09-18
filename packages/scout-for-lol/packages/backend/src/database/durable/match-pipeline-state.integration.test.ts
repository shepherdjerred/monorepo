import { afterAll, describe, expect, test } from "vitest";
import {
  IsoInstantSchema,
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { NotificationIntentSchema } from "@scout-for-lol/domain/notifications/intent.ts";
import {
  AccountIdSchema,
  PlayerIdSchema,
} from "@scout-for-lol/domain/identity/database-ids.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testPuuid } from "#src/testing/test-ids.ts";
import {
  listIntentsForMatch,
  upsertIntent,
} from "#src/database/durable/intent-repository.ts";
import { getMatchPipelineState } from "#src/database/durable/match-pipeline-state.ts";
import { observeMatch } from "#src/database/durable/observation-repository.ts";
import { recordReceipt } from "#src/database/durable/receipt-repository.ts";
import {
  markTrackedAccountCursorAdvanced,
  recordTrackedAccounts,
} from "#src/database/durable/tracked-account-repository.ts";
import { SCOUT_V2_MATCH_RECEIPT_KINDS } from "@scout-for-lol/temporal/match-receipts-v2";

const { prisma } = createTestDatabase("durable-match-pipeline-state");

afterAll(async () => {
  await prisma.$disconnect();
});

const OBSERVED_AT = IsoInstantSchema.parse("2026-09-12T10:00:00.000Z");
const CREATED_AT = IsoInstantSchema.parse("2026-09-12T09:00:00.000Z");
const REGISTERED = testPuuid("registered");
const UNREGISTERED = testPuuid("stranger");

async function observe(matchId: RiotMatchId): Promise<void> {
  await observeMatch(prisma, {
    matchId,
    platformRoute: "NA1",
    policy: "FULL",
    owner: { kind: "temporal-v2" },
    promotion: null,
    gameCreatedAt: CREATED_AT,
    observedAt: OBSERVED_AT,
    deliveryMode: "live",
    artifacts: { match: null, timeline: null },
  });
}

function intentFor(
  matchId: RiotMatchId,
  key: string,
  channelId: string,
): Parameters<typeof upsertIntent>[1] {
  return {
    matchId,
    intent: NotificationIntentSchema.parse({
      key,
      target: { kind: "channel", channelId },
      freshnessDeadline: "2026-09-12T12:00:00.000Z",
      createdAt: OBSERVED_AT,
      attemptCount: 0,
      state: { kind: "pending" },
    }),
  };
}

describe("listIntentsForMatch", () => {
  test("returns one match's intents by key, and no other match's", async () => {
    const mine = RiotMatchIdSchema.parse("NA1_7001");
    const other = RiotMatchIdSchema.parse("NA1_7002");
    await upsertIntent(prisma, intentFor(mine, "b:7001", "300000000000000002"));
    await upsertIntent(prisma, intentFor(mine, "a:7001", "300000000000000001"));
    await upsertIntent(
      prisma,
      intentFor(other, "a:7002", "300000000000000003"),
    );

    // Ordered by key rather than by insertion: the order becomes the order
    // notification children start in, so it must be a property of the data.
    const mineIntents = await listIntentsForMatch(prisma, { matchId: mine });
    expect(mineIntents.map((record) => record.intent.key)).toEqual([
      "a:7001",
      "b:7001",
    ]);
  });
});

describe("getMatchPipelineState", () => {
  test("is absent for a match nothing has observed", async () => {
    expect(
      await getMatchPipelineState(prisma, {
        matchId: RiotMatchIdSchema.parse("NA1_7100"),
      }),
    ).toBeNull();
  });

  test("composes the processing state, its intents and its tracked accounts", async () => {
    const matchId = RiotMatchIdSchema.parse("NA1_7101");
    await observe(matchId);
    // Spelled out rather than built through `durable/match`: the architecture
    // rules keep `database/` from importing the services layered over it, and
    // this read is a repository concern.
    await recordReceipt(prisma, {
      matchId,
      receipt: {
        kind: SCOUT_V2_MATCH_RECEIPT_KINDS.archive,
        version: 1,
        scope: { kind: "global" },
        recordedAt: OBSERVED_AT,
      },
      evidence: JSON.stringify({ kind: "test", version: 1, data: { matchId } }),
    });
    await upsertIntent(
      prisma,
      intentFor(matchId, "notify:7101", "300000000000000004"),
    );
    await recordTrackedAccounts(prisma, [
      {
        matchId,
        puuid: REGISTERED,
        playerId: PlayerIdSchema.parse(1),
        accountId: AccountIdSchema.parse(1),
        cursorAdvancedAt: null,
      },
      {
        matchId,
        puuid: UNREGISTERED,
        playerId: null,
        accountId: null,
        cursorAdvancedAt: null,
      },
    ]);
    await markTrackedAccountCursorAdvanced(prisma, {
      matchId,
      puuid: REGISTERED,
      advancedAt: OBSERVED_AT,
    });

    const state = await getMatchPipelineState(prisma, { matchId });

    expect(state?.processing).toMatchObject({
      matchId,
      owner: { kind: "temporal-v2" },
      policy: "FULL",
      promotion: null,
    });
    expect(state?.processing.receipts.map((receipt) => receipt.kind)).toEqual([
      SCOUT_V2_MATCH_RECEIPT_KINDS.archive,
    ]);
    expect(state?.intents.map((record) => record.intent.key)).toEqual([
      "notify:7101",
    ]);
    expect(
      state?.trackedAccounts.filter(
        (association) => association.cursorAdvancedAt !== null,
      ),
    ).toHaveLength(1);
  });

  test("keeps an unregistered association distinct from a registered one", async () => {
    const matchId = RiotMatchIdSchema.parse("NA1_7102");
    await observe(matchId);
    await recordTrackedAccounts(prisma, [
      {
        matchId,
        puuid: REGISTERED,
        playerId: PlayerIdSchema.parse(2),
        accountId: AccountIdSchema.parse(2),
        cursorAdvancedAt: null,
      },
      {
        matchId,
        puuid: UNREGISTERED,
        playerId: null,
        accountId: null,
        cursorAdvancedAt: null,
      },
    ]);

    const state = await getMatchPipelineState(prisma, { matchId });

    // NULL says the PUUID was tracked but not registered when the match was
    // observed. A non-NULL id whose Account row later disappears says it WAS
    // registered and has been deregistered since. Those are different
    // histories with different remedies, and the aggregate must not summarise
    // them into one "no account".
    const byPuuid = new Map(
      (state?.trackedAccounts ?? []).map((association) => [
        association.puuid,
        association,
      ]),
    );
    expect(byPuuid.get(REGISTERED)?.accountId).toBe(2);
    expect(byPuuid.get(UNREGISTERED)?.accountId).toBeNull();
  });
});
