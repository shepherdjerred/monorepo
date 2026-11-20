import { describe, expect, test } from "vitest";
import {
  COACH_PROACTIVE_LIMITS,
  COACH_TRIGGER_KINDS,
  CoachLiveSchema,
  CoachTriggerSchema,
  DiscordAccountIdSchema,
  type CoachTrigger,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import fixture from "@scout-for-lol/data/scout-client/desktop-fixtures/coach-triggers.json" with { type: "json" };
import {
  PROACTIVE_QUESTION_PREFIX,
  ProactiveTriggerRefusedError,
  admitProactiveTrigger,
  isProactiveTriggerQuestion,
  proactiveTriggerQuestion,
  triggerEvidenceIssue,
  triggerWindowKey,
  type ProactiveReceiptStore,
  type ProactiveTriggerRecord,
  type ProactiveTriggerRefusal,
} from "./proactive-triggers.ts";

const OWNER = DiscordAccountIdSchema.parse("160509172704739328");
const OTHER_OWNER = DiscordAccountIdSchema.parse("160509172704739399");
const DEVICE = "4fa2a856-53af-42a4-85af-5cc085a942a3";
const snapshot = CoachLiveSchema.parse(fixture.request.snapshot);
const triggers: readonly CoachTrigger[] = fixture.triggers.map((trigger) =>
  CoachTriggerSchema.parse(trigger),
);

// The golden triggers, one per kind in contract order, each held to its own
// member of the union.
const [SpikeSchema, FedSchema, ShiftSchema, , StreakSchema] =
  CoachTriggerSchema.options;
const spike = SpikeSchema.parse(fixture.triggers[0]);
const fed = FedSchema.parse(fixture.triggers[1]);
const shift = ShiftSchema.parse(fixture.triggers[2]);
const streak = StreakSchema.parse(fixture.triggers[4]);

type Receipt = {
  readonly ownerId: DiscordAccountId;
  readonly gameKey: string;
  readonly trigger: ProactiveTriggerRecord;
  readonly createdAt: Date;
};

/** An in-memory receipt table with the unique key the database has. */
function fakeStore(): ProactiveReceiptStore & {
  readonly receipts: Receipt[];
  readonly locks: DiscordAccountId[];
} {
  const receipts: Receipt[] = [];
  const locks: DiscordAccountId[] = [];
  return {
    receipts,
    locks,
    lockOwner: async (ownerId) => {
      locks.push(ownerId);
      await Promise.resolve();
    },
    windowTaken: ({ ownerId, gameKey, trigger }) =>
      Promise.resolve(
        receipts.some(
          (receipt) =>
            receipt.ownerId === ownerId &&
            receipt.gameKey === gameKey &&
            receipt.trigger.kind === trigger.kind &&
            receipt.trigger.windowKey === trigger.windowKey,
        ),
      ),
    admittedForGame: ({ ownerId, gameKey }) =>
      Promise.resolve(
        receipts.filter(
          (receipt) =>
            receipt.ownerId === ownerId && receipt.gameKey === gameKey,
        ).length,
      ),
    lastAdmittedAt: (ownerId) =>
      Promise.resolve(
        receipts
          .filter((receipt) => receipt.ownerId === ownerId)
          .map((receipt) => receipt.createdAt)
          .toSorted((a, b) => b.getTime() - a.getTime())[0] ?? null,
      ),
    record: async (receipt) => {
      receipts.push(receipt);
      await Promise.resolve();
    },
  };
}

const START = new Date("2026-11-19T20:00:00.000Z");
function at(seconds: number): Date {
  return new Date(START.getTime() + seconds * 1000);
}

/** The refusal admission threw, or null when it admitted. */
async function admit(
  store: ProactiveReceiptStore,
  input: {
    readonly ownerId?: DiscordAccountId;
    readonly gameKey?: string;
    readonly windowKey: string;
    readonly kind?: CoachTrigger["kind"];
    readonly now: Date;
  },
): Promise<ProactiveTriggerRefusal | null> {
  try {
    await admitProactiveTrigger(store, {
      ownerId: input.ownerId ?? OWNER,
      deviceId: DEVICE,
      gameKey: input.gameKey ?? "g-1",
      trigger: {
        kind: input.kind ?? "enemy_item_spike",
        windowKey: input.windowKey,
      },
      runId: globalThis.crypto.randomUUID(),
      now: input.now,
    });
    return null;
  } catch (error) {
    if (error instanceof ProactiveTriggerRefusedError) return error.refusal;
    throw error;
  }
}

describe("admitProactiveTrigger", () => {
  test("admits a first trigger under the owner's lock and records it", async () => {
    const store = fakeStore();
    expect(await admit(store, { windowKey: "Zed:6692", now: at(0) })).toBe(
      null,
    );
    expect(store.locks).toEqual([OWNER]);
    expect(store.receipts).toHaveLength(1);
    expect(store.receipts[0]?.createdAt).toEqual(at(0));
  });

  test.each([
    [0, { kind: "spacing", retryAfterSeconds: 90 }],
    [1, { kind: "spacing", retryAfterSeconds: 89 }],
    [89.5, { kind: "spacing", retryAfterSeconds: 1 }],
    [90, null],
    [600, null],
  ] as const)(
    "a second trigger %d seconds later answers %o",
    async (seconds, refusal) => {
      const store = fakeStore();
      await admit(store, { windowKey: "Zed:6692", now: at(0) });
      expect(
        await admit(store, {
          kind: "enemy_fed",
          windowKey: "Zed",
          now: at(seconds),
        }),
      ).toEqual(refusal);
    },
  );

  test("spacing is per owner: another owner is not held back", async () => {
    const store = fakeStore();
    await admit(store, { windowKey: "Zed:6692", now: at(0) });
    expect(
      await admit(store, {
        ownerId: OTHER_OWNER,
        windowKey: "Zed:6692",
        now: at(1),
      }),
    ).toBe(null);
  });

  test(`at most ${COACH_PROACTIVE_LIMITS.perGame.toString()} per game per owner`, async () => {
    const store = fakeStore();
    const spacing = COACH_PROACTIVE_LIMITS.spacingSeconds;
    for (let index = 0; index < COACH_PROACTIVE_LIMITS.perGame; index += 1) {
      expect(
        await admit(store, {
          windowKey: `w-${index.toString()}`,
          now: at(index * spacing),
        }),
      ).toBe(null);
    }
    const later = at(COACH_PROACTIVE_LIMITS.perGame * spacing);
    expect(await admit(store, { windowKey: "w-next", now: later })).toEqual({
      kind: "game_cap",
      limit: COACH_PROACTIVE_LIMITS.perGame,
    });
    // The next game starts with a fresh allowance.
    expect(
      await admit(store, { gameKey: "g-2", windowKey: "w-next", now: later }),
    ).toBe(null);
    expect(store.receipts).toHaveLength(COACH_PROACTIVE_LIMITS.perGame + 1);
  });

  test("the same event is admitted once, and its retry reads as a duplicate, not as too soon", async () => {
    const store = fakeStore();
    await admit(store, { windowKey: "Zed:6692", now: at(0) });
    expect(await admit(store, { windowKey: "Zed:6692", now: at(1) })).toEqual({
      kind: "duplicate",
    });
    expect(
      await admit(store, { windowKey: "Zed:6692", now: at(3600) }),
    ).toEqual({ kind: "duplicate" });
    // The same window under another kind, or in another game, is another event.
    expect(
      await admit(store, {
        kind: "enemy_fed",
        windowKey: "Zed:6692",
        now: at(90),
      }),
    ).toBe(null);
    expect(store.receipts).toHaveLength(2);
  });

  test("a refused trigger records nothing", async () => {
    const store = fakeStore();
    await admit(store, { windowKey: "a", now: at(0) });
    await admit(store, { windowKey: "a", now: at(100) });
    await admit(store, { windowKey: "b", now: at(10) });
    expect(store.receipts.map((receipt) => receipt.trigger.windowKey)).toEqual([
      "a",
    ]);
  });
});

describe("trigger evidence", () => {
  test("the golden triggers cover every kind and all match their snapshot", () => {
    expect(triggers.map((trigger) => trigger.kind)).toEqual([
      ...COACH_TRIGGER_KINDS,
    ]);
    for (const trigger of triggers) {
      expect(triggerEvidenceIssue(trigger, snapshot), trigger.kind).toBe(null);
    }
  });

  test.each<[string, CoachTrigger]>([
    ["an item spike on an ally", { ...spike, champion: "Garen" }],
    [
      "an item spike for an item the enemy does not hold",
      {
        ...spike,
        itemId: 3031,
        itemName: "Infinity Edge",
      },
    ],
    [
      "an item spike whose name differs from the scoreboard",
      { ...spike, itemName: "Something Else" },
    ],
    ["a fed score the scoreboard does not show", { ...fed, kills: 12 }],
    ["a fed ally", { ...fed, champion: "Ahri" }],
    ["a shift to the profile it came from", { ...shift, to: "mixed" }],
    ["a death count that is not the player's", { ...streak, deaths: 9 }],
    [
      "a streak longer than the player's deaths",
      { ...streak, deathsWithoutTakedown: 5 },
    ],
  ])("refuses %s", (_reason, trigger) => {
    expect(triggerEvidenceIssue(trigger, snapshot)).not.toBe(null);
  });

  test("a snapshot without the local player matches no evidence", () => {
    const anonymous = {
      ...snapshot,
      participants: snapshot.participants.map((player) => ({
        ...player,
        isSelf: false,
      })),
    };
    for (const trigger of triggers) {
      expect(triggerEvidenceIssue(trigger, anonymous)).not.toBe(null);
    }
  });
});

describe("trigger windows and questions", () => {
  test("each kind names its event by what the evidence says, not by the client", () => {
    expect(triggers.map((trigger) => triggerWindowKey(trigger))).toEqual([
      "Zed:6692",
      "Zed",
      "physical",
      "enemy_team",
      "4",
    ]);
  });

  test("every question is server-worded, starts with the proactive marker, and names only evidence", () => {
    for (const trigger of triggers) {
      const question = proactiveTriggerQuestion(trigger);
      expect(question.startsWith(`${PROACTIVE_QUESTION_PREFIX} `)).toBe(true);
      expect(isProactiveTriggerQuestion(question)).toBe(true);
    }
    expect(proactiveTriggerQuestion(spike)).toBe(
      "Scout noticed the enemy Zed completed Eclipse. What, if anything, should I consider?",
    );
    expect(isProactiveTriggerQuestion("What should I buy?")).toBe(false);
    expect(isProactiveTriggerQuestion("Scout noticed")).toBe(false);
  });
});
