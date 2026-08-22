import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  BucksPredictionSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import {
  RECENT_RESOLVED_PEEK_WINDOW_MS,
  describePeekResult,
  peekAtGame,
  renderPeekEstimate,
} from "#src/betting/peek.ts";
import {
  bucksTestDiscordId,
  bucksTestRoster,
} from "#src/testing/bucks-fixtures.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

const { prisma: db } = createTestDatabase("bucks-peek");
const SERVER_ID = DiscordGuildIdSchema.parse("1337623164146155593");
const USER_ID = bucksTestDiscordId(1);
const NOW = new Date("2026-08-19T00:02:00Z");
const AVAILABLE_AT = new Date("2026-08-19T00:02:00Z");

const v2Prediction = BucksPredictionSchema.parse({
  version: 2,
  blueWinProbability: 0.584,
  dataQuality: "medium",
  coverage: { covered: 25, applicable: 50 },
  drivers: ["Blue rank edge", "Red recent-form edge"],
});

async function clearAll(): Promise<void> {
  await db.bucksMatchPool.deleteMany();
  await db.bucksAccount.deleteMany();
}

async function createPass(expiresAt = new Date("2026-08-20T00:00:00Z")) {
  await db.bucksAccount.create({
    data: {
      serverId: SERVER_ID,
      discordId: USER_ID,
      balance: 25,
      peekPassExpiresAt: expiresAt,
    },
  });
}

async function createPool(
  input: {
    matchId?: string;
    state?: "open" | "closed" | "settled" | "voided";
    prediction?: unknown;
    availableAt?: Date;
    detectedAt?: Date;
    settledAt?: Date;
  } = {},
): Promise<void> {
  const state = input.state ?? "open";
  await db.bucksMatchPool.create({
    data: {
      matchId: input.matchId ?? "NA1_5000000001",
      serverId: SERVER_ID,
      detectedAt: input.detectedAt ?? new Date("2026-08-19T00:00:00Z"),
      closesAt: new Date("2026-08-19T00:10:00Z"),
      peekAvailableAt: input.availableAt ?? AVAILABLE_AT,
      roster: JSON.stringify({ participants: bucksTestRoster() }),
      poolState: state,
      predictionJson:
        input.prediction === undefined
          ? JSON.stringify(v2Prediction)
          : input.prediction === null
            ? null
            : JSON.stringify(input.prediction),
      winningTeamId: state === "settled" ? 100 : null,
      voidReason: state === "voided" ? "remake" : null,
      ...(state === "settled" || state === "voided"
        ? { settledAt: input.settledAt ?? NOW }
        : {}),
    },
  });
}

beforeEach(clearAll);

afterAll(async () => {
  await clearAll();
  await db.$disconnect();
});

describe("peekAtGame", () => {
  test("returns private pass states before looking up a game", async () => {
    expect(
      await peekAtGame(
        {
          serverId: SERVER_ID,
          discordId: USER_ID,
          requestedAlias: "jerred",
          now: NOW,
        },
        db,
      ),
    ).toEqual({ kind: "no_pass" });
    await createPass(new Date(NOW.getTime() - 1));
    const expired = await peekAtGame(
      {
        serverId: SERVER_ID,
        discordId: USER_ID,
        requestedAlias: "jerred",
        now: NOW,
      },
      db,
    );
    expect(expired.kind).toBe("expired_pass");
  });

  test("refuses immediately before two minutes and reveals at the boundary", async () => {
    await createPass();
    await createPool();
    const early = await peekAtGame(
      {
        serverId: SERVER_ID,
        discordId: USER_ID,
        requestedAlias: "jerred",
        now: new Date(AVAILABLE_AT.getTime() - 1),
      },
      db,
    );
    expect(early).toEqual({ kind: "not_ready", availableAt: AVAILABLE_AT });
    expect(describePeekResult(early)).toContain(
      `<t:${Math.floor(AVAILABLE_AT.getTime() / 1000).toString()}:R>`,
    );
    const ready = await peekAtGame(
      {
        serverId: SERVER_ID,
        discordId: USER_ID,
        requestedAlias: "jerred",
        now: AVAILABLE_AT,
      },
      db,
    );
    expect(ready.kind).toBe("revealed");
  });

  test("keeps peeking available after betting closes", async () => {
    await createPass();
    await createPool({ state: "closed" });
    const result = await peekAtGame(
      {
        serverId: SERVER_ID,
        discordId: USER_ID,
        requestedAlias: "jerred",
        now: NOW,
      },
      db,
    );
    expect(result.kind).toBe("revealed");
  });

  test("selects the newest unresolved pool when an alias starts another game", async () => {
    await createPass();
    await createPool({
      matchId: "NA1_5000000000",
      state: "closed",
      detectedAt: new Date("2026-08-18T23:00:00Z"),
      prediction: {
        ...v2Prediction,
        blueWinProbability: 0.2,
      },
    });
    await createPool({
      matchId: "NA1_5000000002",
      detectedAt: new Date("2026-08-19T00:01:00Z"),
      prediction: {
        ...v2Prediction,
        blueWinProbability: 0.7,
      },
    });

    const result = await peekAtGame(
      {
        serverId: SERVER_ID,
        discordId: USER_ID,
        requestedAlias: "jerred",
        now: NOW,
      },
      db,
    );

    expect(result).toEqual(
      expect.objectContaining({
        content: expect.stringContaining("70% win / 30% loss"),
      }),
    );
  });

  test("does not reveal an older unresolved game after a newer game resolves", async () => {
    await createPass();
    await createPool({
      matchId: "NA1_5000000000",
      state: "closed",
      detectedAt: new Date("2026-08-18T23:00:00Z"),
    });
    await createPool({
      matchId: "NA1_5000000002",
      state: "settled",
      detectedAt: new Date("2026-08-19T00:01:00Z"),
      settledAt: NOW,
    });

    const result = await peekAtGame(
      {
        serverId: SERVER_ID,
        discordId: USER_ID,
        requestedAlias: "jerred",
        now: NOW,
      },
      db,
    );

    expect(result.kind).toBe("resolved_game");
  });

  test("reveals a newer unresolved game after an older game resolves", async () => {
    await createPass();
    await createPool({
      matchId: "NA1_5000000000",
      state: "settled",
      detectedAt: new Date("2026-08-18T23:00:00Z"),
      settledAt: new Date("2026-08-18T23:30:00Z"),
    });
    await createPool({
      matchId: "NA1_5000000002",
      state: "open",
      detectedAt: new Date("2026-08-19T00:01:00Z"),
      prediction: { ...v2Prediction, blueWinProbability: 0.7 },
    });

    const result = await peekAtGame(
      {
        serverId: SERVER_ID,
        discordId: USER_ID,
        requestedAlias: "jerred",
        now: NOW,
      },
      db,
    );

    expect(result).toEqual(
      expect.objectContaining({
        content: expect.stringContaining("70% win / 30% loss"),
      }),
    );
  });
});

describe("peekAtGame rendering and terminal states", () => {
  test("inverts the same frozen probability for aliases on opposite teams", async () => {
    await createPass();
    await createPool();
    const blue = await peekAtGame(
      {
        serverId: SERVER_ID,
        discordId: USER_ID,
        requestedAlias: "jerred",
        now: NOW,
      },
      db,
    );
    const red = await peekAtGame(
      {
        serverId: SERVER_ID,
        discordId: USER_ID,
        requestedAlias: "bryan",
        now: NOW,
      },
      db,
    );
    expect(blue).toEqual(
      expect.objectContaining({
        content: expect.stringContaining("58% win / 42% loss"),
      }),
    );
    expect(red).toEqual(
      expect.objectContaining({
        content: expect.stringContaining("42% win / 58% loss"),
      }),
    );
    if (red.kind !== "revealed") {
      throw new Error("expected red-team reveal");
    }
    expect(red.content).toContain("the opposing team rank edge");
    expect(red.content).toContain("your team recent-form edge");
  });

  test("continues to parse legacy unversioned pool predictions", async () => {
    await createPass();
    await createPool({
      prediction: {
        winProbability: 0.63,
        subjectTeamId: 100,
        confidence: "low",
        sentence: "Legacy prediction",
        drivers: ["Blue rank edge"],
      },
    });
    const result = await peekAtGame(
      {
        serverId: SERVER_ID,
        discordId: USER_ID,
        requestedAlias: "bryan",
        now: NOW,
      },
      db,
    );
    expect(result).toEqual(
      expect.objectContaining({
        content: expect.stringContaining("37% win / 63% loss"),
      }),
    );
  });

  test("returns resolved, unknown, and unavailable-analysis states", async () => {
    await createPass();
    await createPool({ state: "settled" });
    const resolved = await peekAtGame(
      {
        serverId: SERVER_ID,
        discordId: USER_ID,
        requestedAlias: "jerred",
        now: NOW,
      },
      db,
    );
    expect(resolved.kind).toBe("resolved_game");
    const unknown = await peekAtGame(
      {
        serverId: SERVER_ID,
        discordId: USER_ID,
        requestedAlias: "nobody",
        now: NOW,
      },
      db,
    );
    expect(unknown.kind).toBe("unknown_game");

    await db.bucksMatchPool.deleteMany();
    await createPool({ prediction: null });
    const unavailable = await peekAtGame(
      {
        serverId: SERVER_ID,
        discordId: USER_ID,
        requestedAlias: "jerred",
        now: NOW,
      },
      db,
    );
    expect(unavailable.kind).toBe("unavailable_analysis");
  });

  test("fails loudly when a non-null stored prediction is malformed", async () => {
    await createPass();
    await createPool();

    for (const predictionJson of [
      "not json",
      JSON.stringify({ version: 99 }),
    ]) {
      await db.bucksMatchPool.updateMany({ data: { predictionJson } });
      await expect(
        peekAtGame(
          {
            serverId: SERVER_ID,
            discordId: USER_ID,
            requestedAlias: "jerred",
            now: NOW,
          },
          db,
        ),
      ).rejects.toThrow();
    }
  });

  test("does not treat an alias from an old terminal pool as a current resolved game", async () => {
    await createPass();
    await createPool({
      state: "settled",
      settledAt: new Date(NOW.getTime() - RECENT_RESOLVED_PEEK_WINDOW_MS - 1),
    });

    const result = await peekAtGame(
      {
        serverId: SERVER_ID,
        discordId: USER_ID,
        requestedAlias: "jerred",
        now: NOW,
      },
      db,
    );

    expect(result).toEqual({ kind: "unknown_game", validAliases: [] });
  });
});

test("display rounding always remains complementary", () => {
  const text = renderPeekEstimate({ prediction: v2Prediction, teamId: 100 });
  expect(text).toContain("58% win / 42% loss");
});
