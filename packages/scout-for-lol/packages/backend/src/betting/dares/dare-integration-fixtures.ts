import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  PlayerIdSchema,
  RawMatchSchema,
  RawParticipantSchema,
  type DiscordAccountId,
  type RawMatch,
} from "@scout-for-lol/data";
import { DARE_WINDOW_INGESTION_GRACE_MS } from "#src/betting/constants.ts";
import { acceptDare } from "#src/betting/dares/lifecycle/dare-accept.ts";
import {
  confirmDare,
  createProposedDare,
  type CreateProposedDareInput,
} from "#src/betting/dares/lifecycle/dare-create.ts";
import {
  DareConditionsSchema,
  type DareConditions,
} from "#src/betting/dares/evaluation/dare-criteria.ts";
import { settleDaresForMatch } from "#src/betting/dares/settlement/dare-settle.ts";
import {
  addFlagOverride,
  clearFlagOverrides,
  isPolicyEnabled,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { reconcileBucksBalances } from "#src/betting/settlement/reconcile.ts";
import {
  bucksTestDiscordId,
  bucksTestPuuid,
} from "#src/testing/bucks-fixtures.ts";
import { afterAll, beforeEach, expect } from "vitest";

/**
 * Shared fixtures and helper factories for the dare integration suites
 * (`dare.integration.test.ts`, `dare-void.integration.test.ts`). Split out
 * because those two files need isolated databases (their own
 * `createTestDatabase(...)`), so the db-bound helpers here are factories
 * rather than plain functions closing over a module-level `db`/`deps` —
 * each test file supplies its own.
 */

export const SERVER_ID = DiscordGuildIdSchema.parse("1337623164146155593");
export const CHANNEL_ID = DiscordChannelIdSchema.parse("133762316414615777");
export const CHALLENGER = bucksTestDiscordId(1);
export const TARGET_A = bucksTestDiscordId(2);
export const TARGET_B = bucksTestDiscordId(3);
export const TARGET_C = bucksTestDiscordId(4);
export const CONTRIBUTOR = bucksTestDiscordId(5);
export const PUUID_A = bucksTestPuuid(30);
export const PUUID_B = bucksTestPuuid(31);
export const PUUID_C = bucksTestPuuid(32);

export async function loadFixtureMatch(): Promise<RawMatch> {
  return RawMatchSchema.parse(
    await Bun.file(
      new URL("../../../../../testdata/rift.json", import.meta.url),
    ).json(),
  );
}

export function winConditions(requiredGames = 1): DareConditions {
  return DareConditionsSchema.parse({
    version: 1,
    root: {
      kind: "all",
      clauses: [
        {
          kind: "all",
          children: [
            {
              kind: "condition",
              requiredGames,
              predicate: {
                kind: "participant_boolean",
                field: "win",
                expected: true,
              },
              champion: null,
            },
          ],
        },
      ],
    },
  });
}

export type TargetSpec = {
  discordId: DiscordAccountId;
  alias: string;
  puuid: string;
};

export function targetsInput(
  specs: readonly TargetSpec[],
): CreateProposedDareInput["targets"] {
  return specs.map((spec, index) => ({
    discordId: spec.discordId,
    playerId: PlayerIdSchema.parse(1000 + index),
    alias: spec.alias,
    accounts: [
      { puuid: spec.puuid, trackingStartedAt: new Date(0).toISOString() },
    ],
  }));
}

/**
 * The fixture match with chosen participants re-identified as dare targets.
 * `assignments` maps a participant index to the frozen PUUID plus overrides.
 */
export function matchFor(
  fixture: RawMatch,
  input: {
    assignments: Record<number, { puuid: string; win?: boolean }>;
    infoOverrides?: Record<string, unknown>;
  },
): RawMatch {
  const reparsed = RawMatchSchema.parse(structuredClone(fixture));
  const participants = reparsed.info.participants.map((participant, index) => {
    const assignment = input.assignments[index];
    if (assignment === undefined) return participant;
    return RawParticipantSchema.parse({
      ...participant,
      puuid: assignment.puuid,
      ...(assignment.win === undefined ? {} : { win: assignment.win }),
    });
  });
  return RawMatchSchema.parse({
    ...reparsed,
    info: { ...reparsed.info, ...input.infoOverrides, participants },
  });
}

function assignmentsFor(
  specs: readonly TargetSpec[],
  win: boolean,
): Record<number, { puuid: string; win?: boolean }> {
  const assignments: Record<number, { puuid: string; win?: boolean }> = {};
  specs.forEach((spec, index) => {
    assignments[index] = { puuid: spec.puuid, win };
  });
  return assignments;
}

export function winningMatch(
  fixture: RawMatch,
  specs: readonly TargetSpec[],
): RawMatch {
  return matchFor(fixture, { assignments: assignmentsFor(specs, true) });
}

export function losingMatch(
  fixture: RawMatch,
  specs: readonly TargetSpec[],
): RawMatch {
  return matchFor(fixture, { assignments: assignmentsFor(specs, false) });
}

/**
 * Registers the `beforeEach`/`afterAll` pair both dare integration suites
 * need: reset the two feature flags for `SERVER_ID` before every test, and
 * disconnect the isolated database once the whole suite finishes.
 */
export function registerDareLifecycleHooks(
  db: ExtendedPrismaClient,
  clearAll: () => Promise<void>,
): void {
  beforeEach(async () => {
    await clearAll();
    clearFlagOverrides("betting_enabled");
    clearFlagOverrides("bucks_dares_enabled");
    addFlagOverride("betting_enabled", true, { server: SERVER_ID });
    addFlagOverride("bucks_dares_enabled", true, { server: SERVER_ID });
  });

  afterAll(async () => {
    resetFlagOverrides("betting_enabled");
    resetFlagOverrides("bucks_dares_enabled");
    await clearAll();
    await db.$disconnect();
  });
}

/** A moment safely past a window-dare's `windowEndsAt` plus the ingestion
 * grace period, for exercising `settleEndedDareWindows`. */
export function pastWindowGrace(t0: Date, windowDays = 1): Date {
  return new Date(
    t0.getTime() +
      windowDays * 24 * 60 * 60 * 1000 +
      DARE_WINDOW_INGESTION_GRACE_MS +
      1000,
  );
}

/**
 * Every db-bound helper the two dare integration suites share, bound to one
 * file's isolated database/dependency object/fixed clock.
 */
export function createDareTestHelpers(
  db: ExtendedPrismaClient,
  t0: Date,
): {
  deps: {
    prismaClient: ExtendedPrismaClient;
    isPolicyEnabled: typeof isPolicyEnabled;
  };
  makeProposed: (input?: {
    amount?: number;
    targets?: readonly TargetSpec[];
    horizonKind?: "next_game" | "window";
    windowDays?: number;
    conditions?: DareConditions;
  }) => Promise<number>;
  makePendingAccept: (
    input?: Parameters<
      ReturnType<typeof createDareTestHelpers>["makeProposed"]
    >[0],
  ) => Promise<number>;
  makeActive: (
    input?: Parameters<
      ReturnType<typeof createDareTestHelpers>["makeProposed"]
    >[0] & { activateAt?: Date },
  ) => Promise<number>;
  balanceOf: (discordId: DiscordAccountId) => Promise<number>;
  houseBalance: () => Promise<number>;
  dareState: (dareId: number) => Promise<string>;
  expectNoDrift: () => Promise<void>;
  settleExpecting: (
    dareId: number,
    match: RawMatch,
    at: Date,
    resolution: "achieved" | "unachieved" | "captured" | "voided",
  ) => Promise<Awaited<ReturnType<typeof settleDaresForMatch>>>;
  clearAll: () => Promise<void>;
} {
  const deps = { prismaClient: db, isPolicyEnabled };

  async function makeProposed(input?: {
    amount?: number;
    targets?: readonly TargetSpec[];
    horizonKind?: "next_game" | "window";
    windowDays?: number;
    conditions?: DareConditions;
  }): Promise<number> {
    const created = await createProposedDare(
      {
        serverId: SERVER_ID,
        channelId: CHANNEL_ID,
        challengerDiscordId: CHALLENGER,
        originalText: "I bet alpha can't win a game",
        translation: null,
        conditions: input?.conditions ?? winConditions(),
        horizonKind: input?.horizonKind ?? "window",
        ...(input?.horizonKind === "next_game"
          ? {}
          : { windowDays: input?.windowDays ?? 7 }),
        amount: input?.amount ?? 5,
        targets: targetsInput(
          input?.targets ?? [
            { discordId: TARGET_A, alias: "alpha", puuid: PUUID_A },
          ],
        ),
      },
      deps,
      t0,
    );
    if (created.kind !== "created") {
      throw new Error(`expected a created dare, got ${created.kind}`);
    }
    return created.dareId;
  }

  async function makePendingAccept(
    input?: Parameters<typeof makeProposed>[0],
  ): Promise<number> {
    const dareId = await makeProposed(input);
    const confirmed = await confirmDare(
      { dareId, serverId: SERVER_ID, challengerDiscordId: CHALLENGER },
      deps,
      t0,
    );
    if (confirmed.kind !== "confirmed") {
      throw new Error(`expected a confirmed dare, got ${confirmed.kind}`);
    }
    return dareId;
  }

  async function makeActive(
    input?: Parameters<typeof makeProposed>[0] & { activateAt?: Date },
  ): Promise<number> {
    const dareId = await makePendingAccept(input);
    for (const spec of input?.targets ?? [
      { discordId: TARGET_A, alias: "alpha", puuid: PUUID_A },
    ]) {
      const accepted = await acceptDare(
        { dareId, serverId: SERVER_ID, targetDiscordId: spec.discordId },
        deps,
        input?.activateAt ?? t0,
      );
      if (accepted.kind !== "accepted") {
        throw new Error(`expected an accepted dare, got ${accepted.kind}`);
      }
    }
    return dareId;
  }

  async function balanceOf(discordId: DiscordAccountId): Promise<number> {
    const account = await db.bucksAccount.findUniqueOrThrow({
      where: { serverId_discordId: { serverId: SERVER_ID, discordId } },
      select: { balance: true },
    });
    return account.balance;
  }

  async function houseBalance(): Promise<number> {
    const house = await db.bucksAccount.findFirstOrThrow({
      where: { serverId: SERVER_ID, isHouse: true },
      select: { balance: true },
    });
    return house.balance;
  }

  async function dareState(dareId: number): Promise<string> {
    const dare = await db.bucksDare.findUniqueOrThrow({
      where: { id: dareId },
      select: { dareState: true },
    });
    return dare.dareState;
  }

  async function expectNoDrift(): Promise<void> {
    expect(await reconcileBucksBalances(db)).toEqual([]);
  }

  /** Settle the match, assert the single expected resolution, and check the
   * dare row landed in the matching state. */
  async function settleExpecting(
    dareId: number,
    match: RawMatch,
    at: Date,
    resolution: "achieved" | "unachieved" | "captured" | "voided",
  ): Promise<Awaited<ReturnType<typeof settleDaresForMatch>>> {
    const summaries = await settleDaresForMatch(match, db, at);
    expect(summaries.map((summary) => summary.resolution)).toEqual([
      resolution,
    ]);
    expect(await dareState(dareId)).toBe(
      resolution === "captured" ? "active" : resolution,
    );
    return summaries;
  }

  async function clearAll(): Promise<void> {
    await db.bucksLedgerEntry.deleteMany();
    await db.bucksDareGame.deleteMany();
    await db.bucksDareContribution.deleteMany();
    await db.bucksDareTarget.deleteMany();
    await db.bucksDare.deleteMany();
    await db.bucksAccount.deleteMany();
    await db.player.deleteMany();
  }

  return {
    deps,
    makeProposed,
    makePendingAccept,
    makeActive,
    balanceOf,
    houseBalance,
    dareState,
    expectNoDrift,
    settleExpecting,
    clearAll,
  };
}
