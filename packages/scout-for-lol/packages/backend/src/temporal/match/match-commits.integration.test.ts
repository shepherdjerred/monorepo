import { afterAll, describe, expect, test, vi } from "vitest";
import {
  IsoInstantSchema,
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  SCOUT_CLIENT_MATCH_TERMINAL_RECEIPT_KIND,
  SCOUT_MATCH_RECEIPT_KINDS,
  SCOUT_MATCH_STAGE_CONFLICT_RECEIPT_KIND,
  scoutClientMatchTerminalEvidenceCodec,
  scoutMatchStageConflictEvidenceCodec,
} from "@scout-for-lol/temporal/match-receipts";
import type * as DatabaseModule from "#src/database/index.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  testAccountId,
  testGuildId,
  testPuuid,
} from "#src/testing/test-ids.ts";

/**
 * The stage-receipt attestation against real receipt rows.
 *
 * The property under test is that a contested stage receipt leaves something
 * DURABLE behind. The Workflow fails the run that met the conflict, but a
 * failed run is invisible to the next execution's resume read; the marker
 * this Activity records is what that read surfaces, and it is the only thing
 * standing between the next execution and a cursor advanced over drift.
 */

const { prisma } = createTestDatabase("scout-v2-match-commits");

vi.mock("#src/database/index.ts", async () => {
  const actual = await vi.importActual<typeof DatabaseModule>(
    "#src/database/index.ts",
  );
  return { ...actual, prisma };
});

const { advanceMatchCursor, recordClientMatchTerminal, recordMatchReceipts } =
  await import("#src/temporal/match/match-commits.ts");
const { listTrackedAccounts, recordTrackedAccounts } =
  await import("#src/database/durable/tracked-account-repository.ts");
const { readMatchPipelineState } =
  await import("#src/temporal/match/match-reads.ts");
const { listReceipts, recordReceipt } =
  await import("#src/database/durable/receipt-repository.ts");
const { buildMatchReceipt } =
  await import("#src/durable/match/receipt-evidence.ts");
const { observeMatch } =
  await import("#src/database/durable/observation-repository.ts");

afterAll(async () => {
  await prisma.$disconnect();
});

const RECORDED_AT = IsoInstantSchema.parse("2026-09-16T10:00:00.000Z");

/** A stage receipt someone else wrote with evidence this core cannot produce. */
async function seedForeignStageReceipt(matchId: RiotMatchId): Promise<void> {
  expect(
    await recordReceipt(
      prisma,
      buildMatchReceipt({
        matchId,
        kind: SCOUT_MATCH_RECEIPT_KINDS.settlement,
        scope: { kind: "global" },
        recordedAt: RECORDED_AT,
        evidence: { kind: "not-this-core's-evidence", version: 1, data: {} },
      }),
    ),
  ).toEqual({ outcome: "applied" });
}

async function seedObservation(matchId: RiotMatchId): Promise<void> {
  expect(
    await observeMatch(prisma, {
      matchId,
      platformRoute: "NA1",
      policy: "FULL",
      owner: { kind: "temporal-v2" },
      promotion: null,
      gameCreatedAt: RECORDED_AT,
      observedAt: RECORDED_AT,
      deliveryMode: "live",
      matchDataSource: "RIOT",
      artifacts: { match: null, timeline: null },
    }),
  ).toEqual({ outcome: "applied" });
}

async function kindsOf(matchId: RiotMatchId): Promise<string[]> {
  const records = await listReceipts(prisma, { matchId });
  return records.map((record) => record.receipt.kind);
}

async function expectDurableMarker(
  matchId: RiotMatchId,
  kind: string,
  parseEvidence: (input: unknown) => unknown,
): Promise<void> {
  const records = await listReceipts(prisma, { matchId });
  const marker = records.find((record) => record.receipt.kind === kind);
  expect(marker).toBeDefined();
  expect(parseEvidence(JSON.parse(marker?.evidence ?? "null"))).toEqual({
    riotMatchId: matchId,
  });

  const resume = await readMatchPipelineState({ riotMatchId: matchId });
  expect(resume.kind).toBe("present");
  if (resume.kind !== "present") {
    throw new Error(`Expected pipeline state for ${matchId}`);
  }
  expect(resume.state.receiptKinds).toContain(kind);
}

describe("recordMatchReceipts", () => {
  test("attests cleanly and records no marker when nothing is contested", async () => {
    const matchId = RiotMatchIdSchema.parse("NA1_8201");

    const result = await recordMatchReceipts({
      stage: "dev",
      riotMatchId: matchId,
      kinds: [
        SCOUT_MATCH_RECEIPT_KINDS.settlement,
        SCOUT_MATCH_RECEIPT_KINDS.progression,
      ],
    });

    expect(result.receipts.map((receipt) => receipt.commit)).toEqual([
      { outcome: "applied" },
      { outcome: "applied" },
    ]);
    expect(await kindsOf(matchId)).not.toContain(
      SCOUT_MATCH_STAGE_CONFLICT_RECEIPT_KIND,
    );
  });

  test("records the durable marker when a stage receipt is contested", async () => {
    const matchId = RiotMatchIdSchema.parse("NA1_8202");
    await seedObservation(matchId);
    await seedForeignStageReceipt(matchId);

    const result = await recordMatchReceipts({
      stage: "dev",
      riotMatchId: matchId,
      kinds: [
        SCOUT_MATCH_RECEIPT_KINDS.settlement,
        SCOUT_MATCH_RECEIPT_KINDS.progression,
      ],
    });

    // Reported honestly — the conflict is in the result — AND made durable.
    expect(result.receipts.map((receipt) => receipt.commit)).toEqual([
      { outcome: "conflict", reason: "receipt-evidence-mismatch" },
      { outcome: "applied" },
    ]);
    await expectDurableMarker(
      matchId,
      SCOUT_MATCH_STAGE_CONFLICT_RECEIPT_KIND,
      (evidence) => scoutMatchStageConflictEvidenceCodec.parse(evidence),
    );
  });

  test("a second contested attestation is not a conflict about a conflict", async () => {
    const matchId = RiotMatchIdSchema.parse("NA1_8203");
    await seedForeignStageReceipt(matchId);

    await recordMatchReceipts({
      stage: "dev",
      riotMatchId: matchId,
      kinds: [SCOUT_MATCH_RECEIPT_KINDS.settlement],
    });
    // The evidence names the match alone, so the second write is
    // already-applied and the Activity does not fail on its own marker.
    await expect(
      recordMatchReceipts({
        stage: "dev",
        riotMatchId: matchId,
        kinds: [SCOUT_MATCH_RECEIPT_KINDS.settlement],
      }),
    ).resolves.toBeDefined();

    const kinds = await kindsOf(matchId);
    expect(
      kinds.filter((kind) => kind === SCOUT_MATCH_STAGE_CONFLICT_RECEIPT_KIND),
    ).toHaveLength(1);
  });
});

describe("recordClientMatchTerminal", () => {
  test("surfaces an operator-review marker recorded before observation", async () => {
    const matchId = RiotMatchIdSchema.parse("NA1_8205");

    await expect(
      recordClientMatchTerminal({ riotMatchId: matchId }),
    ).resolves.toEqual({ outcome: "applied" });
    await expect(
      readMatchPipelineState({ riotMatchId: matchId }),
    ).resolves.toEqual({ kind: "terminal" });
  });

  test("persists an idempotent operator-review marker in pipeline state", async () => {
    const matchId = RiotMatchIdSchema.parse("NA1_8204");
    await seedObservation(matchId);

    await expect(
      recordClientMatchTerminal({ riotMatchId: matchId }),
    ).resolves.toEqual({ outcome: "applied" });
    await expect(
      recordClientMatchTerminal({ riotMatchId: matchId }),
    ).resolves.toEqual({ outcome: "already-applied" });

    await expectDurableMarker(
      matchId,
      SCOUT_CLIENT_MATCH_TERMINAL_RECEIPT_KIND,
      (evidence) => scoutClientMatchTerminalEvidenceCodec.parse(evidence),
    );
  });
});

describe("advanceMatchCursor", () => {
  const PUUID = testPuuid("cursor-source");
  const GUILD = testGuildId("8301");
  const OWNER = testAccountId("8301");

  async function seedTrackedAccount(matchId: RiotMatchId): Promise<void> {
    await prisma.account.deleteMany({ where: { puuid: PUUID } });
    await prisma.player.deleteMany({ where: { serverId: GUILD } });
    const player = await prisma.player.create({
      data: {
        alias: "cursor-source",
        serverId: GUILD,
        creatorDiscordId: OWNER,
        createdTime: new Date(RECORDED_AT),
        updatedTime: new Date(RECORDED_AT),
      },
    });
    await prisma.account.create({
      data: {
        alias: "cursor-source",
        puuid: PUUID,
        region: "AMERICA_NORTH",
        playerId: player.id,
        serverId: GUILD,
        creatorDiscordId: OWNER,
        createdTime: new Date(RECORDED_AT),
        updatedTime: new Date(RECORDED_AT),
      },
    });
    await seedObservation(matchId);
    await recordTrackedAccounts(prisma, [
      {
        matchId,
        puuid: PUUID,
        playerId: null,
        accountId: null,
        cursorAdvancedAt: null,
      },
    ]);
  }

  /** What the client dispatcher leaves behind when it selects its payload. */
  async function selectClientPayload(matchId: RiotMatchId): Promise<void> {
    const device = await prisma.scoutClientDevice.create({
      data: {
        owner: {
          connectOrCreate: {
            where: { discordId: OWNER },
            create: { discordId: OWNER, discordUsername: "owner" },
          },
        },
        pairing: {
          create: {
            secretDigest: crypto.randomUUID(),
            deviceName: "desktop",
            platform: "windows",
            architecture: "x86_64",
            appVersion: "0.1.0",
            protocolVersion: 1,
            expiresAt: new Date(Date.now() + 60_000),
          },
        },
        tokenDigest: crypto.randomUUID(),
        deviceName: "desktop",
        platform: "windows",
        architecture: "x86_64",
        appVersion: "0.1.0",
        protocolVersion: 1,
      },
    });
    const observation = await prisma.scoutClientObservation.create({
      data: {
        observationId: crypto.randomUUID(),
        deviceId: device.id,
        sequence: 1n,
        capturedAt: new Date(RECORDED_AT),
        protocolVersion: 1,
        schemaVersion: 1,
        appVersion: "0.1.0",
        kind: "post_game",
        payload: { resource: "post_game", data: {} },
        bodyDigest: crypto.randomUUID(),
        disposition: "ACCEPTED",
      },
    });
    await prisma.scoutClientCanonicalMatch.create({
      data: {
        riotMatchId: matchId,
        sourceObservationId: observation.observationId,
        payloadDigest: observation.bodyDigest,
        selectedAt: new Date(RECORDED_AT),
      },
    });
  }

  async function storedCursor() {
    return prisma.account.findFirstOrThrow({
      where: { puuid: PUUID },
      select: { lastProcessedMatchId: true },
    });
  }

  test("moves the Riot polling cursor for a Riot match", async () => {
    const matchId = RiotMatchIdSchema.parse("NA1_8301");
    await seedTrackedAccount(matchId);

    await expect(advanceMatchCursor({ riotMatchId: matchId })).resolves.toEqual(
      { advanced: 1, alreadyAdvanced: 0 },
    );
    expect(await storedCursor()).toEqual({ lastProcessedMatchId: matchId });
  });

  test("never anchors the Riot poll on a match only the client saw", async () => {
    // Riot's match list has no such id, so as the cursor it would read as a
    // gap on every poll.
    const matchId = RiotMatchIdSchema.parse("NA1_8302");
    await seedTrackedAccount(matchId);
    await selectClientPayload(matchId);

    await expect(advanceMatchCursor({ riotMatchId: matchId })).resolves.toEqual(
      { advanced: 0, alreadyAdvanced: 0 },
    );
    expect(await storedCursor()).toEqual({ lastProcessedMatchId: null });
    const [association] = await listTrackedAccounts(prisma, { matchId });
    expect(association?.cursorAdvancedAt).not.toBeNull();
  });
});

describe("the Riot late-arrival terminal repair migration", () => {
  const MIGRATION = `${import.meta.dir}/../../../prisma/migrations/20260925060000_riot_late_arrival_terminal_repair/migration.sql`;
  const IN_WINDOW = IsoInstantSchema.parse("2026-09-25T05:54:13.076Z");
  const BEFORE_WINDOW = IsoInstantSchema.parse("2026-09-25T05:52:59.999Z");
  const AFTER_WINDOW = IsoInstantSchema.parse("2026-09-28T00:00:00.000Z");

  async function seedTerminal(
    matchId: RiotMatchId,
    recordedAt: typeof IN_WINDOW,
  ): Promise<void> {
    expect(
      await recordReceipt(
        prisma,
        buildMatchReceipt({
          matchId,
          kind: SCOUT_CLIENT_MATCH_TERMINAL_RECEIPT_KIND,
          scope: { kind: "global" },
          recordedAt,
          evidence: scoutClientMatchTerminalEvidenceCodec.serialize({
            riotMatchId: matchId,
          }),
        }),
      ),
    ).toEqual({ outcome: "applied" });
  }

  async function applyRepair(): Promise<number> {
    return await prisma.$executeRawUnsafe(await Bun.file(MIGRATION).text());
  }

  test("releases exactly the refused Riot matches and is idempotent", async () => {
    const refused = RiotMatchIdSchema.parse("BR1_3285962389");
    const observedTerminal = RiotMatchIdSchema.parse("NA1_8211");
    const olderTerminal = RiotMatchIdSchema.parse("NA1_8212");
    await seedTerminal(refused, IN_WINDOW);
    // An unrelated receipt family on the refused match stays standing.
    await seedForeignStageReceipt(refused);
    // A terminal behind a committed observation came from a match Workflow's
    // own failure, not from the pre-effect refusal.
    await seedObservation(observedTerminal);
    await seedTerminal(observedTerminal, IN_WINDOW);
    await seedTerminal(olderTerminal, BEFORE_WINDOW);
    // A refusal recorded after the incident window is a genuine native-client
    // late arrival and must stand.
    const laterTerminal = RiotMatchIdSchema.parse("NA1_8213");
    await seedTerminal(laterTerminal, AFTER_WINDOW);
    await expect(
      readMatchPipelineState({ riotMatchId: refused }),
    ).resolves.toEqual({ kind: "terminal" });

    // The suite shares one database, so other files' receipts may also be in
    // the window; assert on the rows this test seeded rather than on the
    // global delete count.
    await applyRepair();

    // The resume read no longer blocks the next discovery, and nothing else
    // this test seeded moved.
    async function expectRepaired(): Promise<void> {
      await expect(
        readMatchPipelineState({ riotMatchId: refused }),
      ).resolves.toEqual({ kind: "absent" });
      expect(await kindsOf(refused)).toEqual([
        SCOUT_MATCH_RECEIPT_KINDS.settlement,
      ]);
      expect(await kindsOf(observedTerminal)).toContain(
        SCOUT_CLIENT_MATCH_TERMINAL_RECEIPT_KIND,
      );
      for (const kept of [olderTerminal, laterTerminal]) {
        await expect(
          readMatchPipelineState({ riotMatchId: kept }),
        ).resolves.toEqual({ kind: "terminal" });
      }
    }
    await expectRepaired();

    // Idempotent: a re-run leaves every seeded row exactly as the first run did.
    await applyRepair();
    await expectRepaired();
  });
});
