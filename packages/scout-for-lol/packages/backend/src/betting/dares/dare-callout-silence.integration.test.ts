import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DareContractSchema,
  DareSqlEvidenceSchema,
  RawMatchSchema,
  type DareSqlEvidence,
  type DareTargetBinding,
  type RawMatch,
} from "@scout-for-lol/data";
import { silentSettlementSink } from "#src/betting/notify/announcement-sink.ts";
import { makeTwistedFateMatch } from "#src/betting/dares/dare-test-fixtures.ts";
import {
  addFlagOverride,
  clearFlagOverrides,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { notificationIntentRowToRecord } from "#src/database/durable/intent-row.ts";
import { dareStatusAnnouncementCodec } from "#src/betting/dares/presentation/notify/dare-status-message.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
} from "#src/testing/test-ids.ts";

/**
 * The silence guarantee, where a Dare callout is concerned.
 *
 * Its own file rather than a section of the Dare lifecycle suite, because it
 * asks a different question of the same code: not "does the callout post
 * correctly" but "does withholding it actually suppress it". The answer turns
 * on durable state that outlives the call — `calloutRefreshPending` — so the
 * assertions are about what a LATER, unrelated scan finds, and that reads
 * badly interleaved with the delivery mechanics.
 *
 * The SQL compiler is real; lake execution is stubbed so each test decides
 * whether its match resolves the Dare.
 */

type LakeEvidence = { achieved: boolean | null };
const lake = vi.hoisted((): LakeEvidence => ({ achieved: false }));

vi.mock("#src/betting/dares/sql/dare-sql.ts", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "#src/betting/dares/sql/dare-sql.ts",
  );
  return {
    ...actual,
    executeDareSql: (input: {
      compilation: { queryHash: string };
      targets: readonly { key: string }[];
    }): Promise<DareSqlEvidence> =>
      Promise.resolve(
        DareSqlEvidenceSchema.parse({
          achieved: lake.achieved,
          results: [],
          targetDependencies: input.targets.map((target) => target.key),
          coverage: "complete",
          sourceMatchIds: [],
          queryHash: input.compilation.queryHash,
        }),
      ),
    decisiveTargetDependencies: (input: {
      targets: readonly { key: string }[];
    }) => Promise.resolve(input.targets.map((target) => target.key)),
  };
});

const { createDareDraft } =
  await import("#src/betting/dares/lifecycle/dare-draft.ts");
const { createDareConfirmationIntent } =
  await import("#src/betting/dares/lifecycle/dare-intent.ts");
const { consumeDareConfirmationIntent } =
  await import("#src/betting/dares/lifecycle/dare-intent-consume.ts");
const { ensureDareCallout } =
  await import("#src/betting/dares/presentation/dare-callout.ts");
const { settleDaresForMatch } =
  await import("#src/betting/dares/settlement/dare-settle.ts");
const { settleAndAwardBucks } =
  await import("#src/betting/markets/postmatch-hook.ts");

const { prisma: db } = createTestDatabase("bucks-dare-callout-silence");
const SERVER = testGuildId("921");
const CHANNEL = testChannelId("922");
const CHALLENGER = testAccountId("923");
const TARGET = testAccountId("924");
const T0 = new Date("2026-09-01T12:00:00.000Z");

const TARGET_BINDING: DareTargetBinding = {
  key: "T1",
  discordId: TARGET,
  playerId: 1,
  alias: "Virmel",
  accounts: [
    { puuid: "virmel-puuid", trackingStartedAt: "2026-01-01T00:00:00.000Z" },
  ],
};

const FLAGS = ["betting_enabled", "bucks_dares_enabled"] as const;

const deps = {
  prismaClient: db,
  isPolicyEnabled: (name: string) =>
    Promise.resolve(FLAGS.map(String).includes(name)),
};

afterAll(() => {
  for (const flag of FLAGS) resetFlagOverrides(flag);
});

beforeEach(async () => {
  // The lifecycle reads the real flag store, not `deps.isPolicyEnabled`, so
  // the overrides are what let a draft be funded at all.
  for (const flag of FLAGS) {
    clearFlagOverrides(flag);
    addFlagOverride(flag, true, { server: SERVER });
  }
  lake.achieved = false;
  await db.matchNotificationIntent.deleteMany();
  await db.confirmationIntent.deleteMany();
  await db.bucksDareEvidence.deleteMany();
  await db.bucksDareContribution.deleteMany();
  await db.bucksDareTarget.deleteMany();
  await db.bucksDareRevision.deleteMany();
  await db.bucksDare.deleteMany();
  await db.bucksLedgerEntry.deleteMany();
  await db.bucksAccount.deleteMany();
});

/**
 * A Dare past draft with no callout yet: the one state where
 * `ensureDareCallout` would POST rather than edit.
 *
 * Built through the real lifecycle rather than inserted, because a
 * hand-written row would prove the query and not the path.
 */
async function fundedDare(key: string): Promise<number> {
  const draft = await createDareDraft(
    {
      serverId: SERVER,
      channelId: CHANNEL,
      challengerDiscordId: CHALLENGER,
      originalText: "I bet Virmel can't win a game",
      queryText: "SELECT COUNT(*) >= 1 AS achieved FROM T1 p WHERE p.win",
      plainLanguage: "Virmel wins at least one eligible game.",
      targets: [TARGET_BINDING],
      deadlineSpec: { kind: "relative", days: 7 },
      // Small on purpose: the seed grant has to fund two Dares in the test
      // that needs an unrelated one, and the amount is incidental here.
      openingStake: 5,
    },
    deps,
    T0,
  );
  if (draft.kind !== "created") throw new Error("Expected a Dare draft.");
  const funding = await createDareConfirmationIntent(
    {
      dareId: draft.dareId,
      serverId: SERVER,
      actorDiscordId: CHALLENGER,
      expectedRevision: 1,
      payload: { kind: "dare_fund" },
      idempotencyKey: key,
    },
    deps,
    T0,
  );
  if (funding.kind !== "intent_created") {
    throw new Error("Expected a funding intent.");
  }
  const funded = await consumeDareConfirmationIntent(
    {
      intentId: funding.intentId,
      serverId: SERVER,
      actorDiscordId: CHALLENGER,
    },
    deps,
    T0,
  );
  // Asserted, not assumed: an unfunded Dare has no pending callout, and a
  // test that silently got one would prove nothing about withholding.
  if (funded.kind !== "funded") {
    throw new Error(`Expected a funded Dare, got ${funded.kind}`);
  }
  return draft.dareId;
}

describe("withholding a Dare callout", () => {
  test("withholds the post without touching any other Dare's work", async () => {
    // The scan this runs under selects EVERY globally pending Dare, so a
    // decision about one match must not write to rows that match never
    // touched. Retiring from here suppressed unrelated live callouts
    // permanently — strictly worse than the late post it was fixing.
    const withheld = await fundedDare("fund-callout-withheld");
    const unrelated = await fundedDare("fund-callout-unrelated");
    const sendMessage = vi.fn(() =>
      Promise.resolve({ channelId: CHANNEL, id: "never-sent" }),
    );

    await expect(
      ensureDareCallout(withheld, {
        prismaClient: db,
        sendMessage,
        editMessage: vi.fn(() => Promise.resolve()),
        mayPost: () => false,
      }),
    ).resolves.toBe("withheld");

    expect(sendMessage).not.toHaveBeenCalled();
    // Both Dares keep their pending work: withholding a post decides nothing
    // durable, and the Dare this match DID resolve is retired inside the
    // settlement's own transaction instead.
    for (const dareId of [withheld, unrelated]) {
      expect(
        await db.bucksDare.findUniqueOrThrow({
          where: { id: dareId },
          select: { calloutRefreshPending: true, messageRef: true },
        }),
      ).toEqual({ calloutRefreshPending: true, messageRef: null });
    }
  });
});

/** A Dare past acceptance, which a qualifying match then settles. */
async function activeDare(key: string): Promise<number> {
  const dareId = await fundedDare(`fund-${key}`);
  const accept = await createDareConfirmationIntent(
    {
      dareId,
      serverId: SERVER,
      actorDiscordId: TARGET,
      expectedRevision: 1,
      payload: { kind: "dare_accept" },
      idempotencyKey: `accept-${key}`,
    },
    deps,
    T0,
  );
  if (accept.kind !== "intent_created") {
    throw new Error("Expected an acceptance intent.");
  }
  const accepted = await consumeDareConfirmationIntent(
    { intentId: accept.intentId, serverId: SERVER, actorDiscordId: TARGET },
    deps,
    T0,
  );
  if (accepted.kind !== "accepted" || !accepted.activated) {
    throw new Error("Expected an active Dare.");
  }
  // Frozen as monotone, so a satisfied match resolves it on the spot.
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
  return dareId;
}

/** The outbox rows standing for one Dare, as `category/kind`. */
async function outboxKinds(dareId: number): Promise<string[]> {
  const rows = await db.matchNotificationIntent.findMany({
    where: { subjectKind: "dare", subjectId: dareId.toString() },
    orderBy: { intentKey: "asc" },
  });
  return rows.map((row) => {
    const record = notificationIntentRowToRecord(row);
    if (!("dareId" in record) || record.intent.announcement === undefined) {
      throw new Error("Expected a Dare status intent");
    }
    const announcement = dareStatusAnnouncementCodec.parse(
      record.intent.announcement,
    );
    return `${announcement.category}/${announcement.kind}`;
  });
}

function matchFor(matchId: string, fixture: RawMatch): RawMatch {
  return makeTwistedFateMatch(fixture, {
    matchId,
    timePlayed: 25 * 60,
    creepScore: 200,
    gameStartTimestamp: T0.getTime() + 60 * 60 * 1000,
  });
}

async function riftFixture(): Promise<RawMatch> {
  return RawMatchSchema.parse(
    await Bun.file(
      new URL("../../../../../testdata/rift.json", import.meta.url),
    ).json(),
  );
}

/** A match that does NOT resolve the Dare, so its capture stays open. */
async function nonResolvingMatch(matchId: string): Promise<RawMatch> {
  lake.achieved = false;
  return matchFor(matchId, await riftFixture());
}

/** A match the active Dare's contract resolves against. */
async function qualifyingMatch(matchId: string): Promise<RawMatch> {
  lake.achieved = true;
  return matchFor(matchId, await riftFixture());
}

describe("withholding a Dare notification", () => {
  test("a CAPTURED Dare says nothing either, and keeps nothing pending", async () => {
    // A capture is not final, but it still says something: progress toward a
    // Dare, and a callout the capture just marked for refresh. Neither
    // consulted the delivery mode, so a backfill announced its progress and
    // handed its callout to the next scanner.
    const dareId = await activeDare("withheld-capture");
    const beforeSettlement = await outboxKinds(dareId);

    // A match the Dare's contract does NOT resolve on: it captures evidence
    // and stays active, which is the state under test.
    await settleDaresForMatch(await nonResolvingMatch("NA1_7000000004"), db, {
      now: new Date(T0.getTime() + 2 * 60 * 60 * 1000),
      notify: "withhold",
    });

    expect(await outboxKinds(dareId)).toEqual(beforeSettlement);
    expect(
      await db.bucksDare.findUniqueOrThrow({
        where: { id: dareId },
        select: { dareState: true, calloutRefreshPending: true },
      }),
    ).toEqual({ dareState: "active", calloutRefreshPending: false });
  });

  test("writes no outbox row for a match owed no public delivery", async () => {
    // Withholding the DRAIN was never suppression: a row left behind is sent
    // minutes later by a caller that was never told to keep it quiet. The
    // only durable suppression is the row never being written.
    const dareId = await activeDare("withheld-notification");
    // Funding and acceptance enqueue their own lifecycle rows, and those are
    // a user's actions rather than this match's announcement. What is under
    // test is whether SETTLEMENT adds one.
    const beforeSettlement = await outboxKinds(dareId);

    await settleDaresForMatch(await qualifyingMatch("NA1_7000000001"), db, {
      now: new Date(T0.getTime() + 2 * 60 * 60 * 1000),
      notify: silentSettlementSink.mayEnqueueDareNotification()
        ? "enqueue"
        : "withhold",
    });

    // The Dare settled — the silence is about announcing, never about money.
    const settled = await db.bucksDare.findUniqueOrThrow({
      where: { id: dareId },
      select: { dareState: true },
    });
    expect(settled.dareState).not.toBe("active");
    expect(await outboxKinds(dareId)).toEqual(beforeSettlement);
    // And the callout this match's Dare was waiting on is retired with it,
    // in the same transaction: the flag is durable work, and leaving it set
    // hands the post to the next scanner.
    expect(
      await db.bucksDare.findUniqueOrThrow({
        where: { id: dareId },
        select: { calloutRefreshPending: true },
      }),
    ).toEqual({ calloutRefreshPending: false });
  });

  test("writes one for a match that is owed one", async () => {
    // The pair: the withholding is a decision about this match, not a change
    // to what settlement does.
    const dareId = await activeDare("enqueued-notification");
    const beforeSettlement = await outboxKinds(dareId);

    await settleDaresForMatch(await qualifyingMatch("NA1_7000000002"), db, {
      now: new Date(T0.getTime() + 2 * 60 * 60 * 1000),
    });

    const afterSettlement = await outboxKinds(dareId);
    expect(afterSettlement.length).toBeGreaterThan(beforeSettlement.length);
    // A live match's Dare keeps its pending callout, to be posted.
    expect(
      await db.bucksDare.findUniqueOrThrow({
        where: { id: dareId },
        select: { calloutRefreshPending: true },
      }),
    ).toEqual({ calloutRefreshPending: true });
  });

  test("carries the decision from the sink the settlement was handed", async () => {
    // The tests above hand the disposition to the Dare settler directly. This
    // one starts where production does — one sink, given to the whole
    // post-match hook — so a hook that stopped consulting it is a failure
    // here rather than an unproved assumption.
    const dareId = await activeDare("hook-withheld-notification");
    const beforeSettlement = await outboxKinds(dareId);

    await settleAndAwardBucks(await qualifyingMatch("NA1_7000000003"), db, {
      announcementSink: silentSettlementSink,
    });

    expect(await outboxKinds(dareId)).toEqual(beforeSettlement);
  });
});
