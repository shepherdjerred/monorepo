import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import {
  PlayerConfigEntrySchema,
  RawMatchSchema,
  type PlayerConfigEntry,
  type RawMatch,
} from "@scout-for-lol/data";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { loadRawMatchFixture } from "#src/testing/raw-capture-fixtures.ts";
import { testPuuid } from "#src/testing/test-ids.ts";
import { MATCHES_STAGING_DIR } from "#src/report-lake/paths.ts";
import {
  getValidatedPutCommand,
  mockSuccessfulPut,
  resetS3TestState,
  s3Mock,
} from "#src/storage/s3-test-helpers.ts";
import {
  getObservation,
  getProcessingState,
} from "#src/database/durable/observation-repository.ts";
import { listReceipts } from "#src/database/durable/receipt-repository.ts";
import { listTrackedAccounts } from "#src/database/durable/tracked-account-repository.ts";
import { toRiotMatchId } from "#src/durable/match/match-identity.ts";

/**
 * The live post-match ingest gate, end to end against the durable tables.
 *
 * Everything below the gate is real: the receipted archive builds its
 * descriptor from the put the S3 client actually received, the lake staging
 * writes real files, and the durable services write real rows. Only the object
 * store's transport is mocked, because the archive's answer — the key it used
 * and the digest of the bytes — is the thing these tests are about.
 */

const { prisma } = createTestDatabase("persist-authoritative-match");

vi.doMock("#src/database/index.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  prisma,
}));

const { persistAuthoritativeMatch } =
  await import("#src/league/tasks/postmatch/match-history-polling-effects.ts");

const TRACKED_PUUID = testPuuid("polled");

const trackedPlayer: PlayerConfigEntry = PlayerConfigEntrySchema.parse({
  alias: "Polled",
  league: { leagueAccount: { puuid: TRACKED_PUUID, region: "AMERICA_NORTH" } },
});

let lakeDir: string;
let matchFixture: RawMatch;

/** The same payload under a fresh match id, so each test owns its rows. */
function matchNumbered(gameId: number): RawMatch {
  return RawMatchSchema.parse({
    ...matchFixture,
    metadata: { ...matchFixture.metadata, matchId: `NA1_${String(gameId)}` },
  });
}

async function persist(match: RawMatch): Promise<void> {
  await persistAuthoritativeMatch({
    matchData: match,
    matchId: match.metadata.matchId,
    trackedPlayers: [trackedPlayer],
    silent: false,
  });
}

async function receiptKindsFor(matchId: string): Promise<string[]> {
  const receipts = await listReceipts(prisma, {
    matchId: toRiotMatchId(matchId),
  });
  return receipts.map((entry) => entry.receipt.kind);
}

beforeEach(async () => {
  matchFixture = await loadRawMatchFixture();
  lakeDir = await mkdtemp(path.join(tmpdir(), "persist-match-lake-"));
  Bun.env["REPORT_LAKE_DIR"] = lakeDir;
  resetS3TestState();
  mockSuccessfulPut();
});

afterEach(async () => {
  resetS3TestState();
  await rm(lakeDir, { recursive: true, force: true });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("the authoritative ingest gate", () => {
  test("stamps the observation with the object the archive really wrote", async () => {
    const match = matchNumbered(7001);

    await persist(match);

    const observation = await getObservation(prisma, {
      matchId: toRiotMatchId(match.metadata.matchId),
    });
    // The columns this wave exists to fill: an identity taken from the put,
    // not reconstructed from the key layout.
    const put = getValidatedPutCommand();
    expect(observation?.artifacts.match?.key).toBe(put.input.Key);
    expect(observation?.artifacts.match?.digest).toBe(
      put.input.Metadata?.["sha256"],
    );

    expect(
      await listTrackedAccounts(prisma, {
        matchId: toRiotMatchId(match.metadata.matchId),
      }),
    ).toHaveLength(1);

    const claim = await prisma.scoutEffectClaim.findUniqueOrThrow({
      where: { key: `raw-match-s3:${match.metadata.matchId}` },
    });
    expect(claim.state).toBe("COMPLETED");
  });

  test("records the archive and the lake projection as receipts", async () => {
    const match = matchNumbered(7002);

    await persist(match);

    expect(await receiptKindsFor(match.metadata.matchId)).toEqual([
      "raw-archive-match",
      "lake-staging-match",
    ]);
  });

  test("a second pass re-archives nothing and leaves the observation standing", async () => {
    const match = matchNumbered(7003);
    await persist(match);
    const putsAfterFirstPass = s3Mock.calls().length;
    const afterFirstPass = await getObservation(prisma, {
      matchId: toRiotMatchId(match.metadata.matchId),
    });

    await persist(match);

    // The effect claim is COMPLETED, so the archive is skipped entirely — but
    // the observation and the account associations are still facts, and the
    // cursor advance ahead needs their rows.
    expect(s3Mock.calls()).toHaveLength(putsAfterFirstPass);
    const state = await getProcessingState(prisma, {
      matchId: toRiotMatchId(match.metadata.matchId),
    });
    expect(state?.owner).toEqual({ kind: "legacy-v1" });
    expect(
      await listTrackedAccounts(prisma, {
        matchId: toRiotMatchId(match.metadata.matchId),
      }),
    ).toHaveLength(1);

    // The second pass has no descriptor to offer. Its silence neither erases
    // the identity the first pass stamped nor restamps the observation.
    const afterSecondPass = await getObservation(prisma, {
      matchId: toRiotMatchId(match.metadata.matchId),
    });
    expect(afterSecondPass).toEqual(afterFirstPass);
    expect(afterSecondPass?.artifacts.match).not.toBeNull();
  });

  test("an archive completed by a run that recorded nothing still gets its observation", async () => {
    const match = matchNumbered(7004);
    // A previous run archived the match and completed its claim, then ended
    // before the durable write. Nothing else will ever observe this match.
    await prisma.scoutEffectClaim.create({
      data: {
        key: `raw-match-s3:${match.metadata.matchId}`,
        kind: "raw-match-s3",
        state: "COMPLETED",
      },
    });

    await persist(match);

    const observation = await getObservation(prisma, {
      matchId: toRiotMatchId(match.metadata.matchId),
    });
    expect(observation).not.toBeNull();
    // No archive ran this pass, so there is no artifact identity to stamp.
    expect(observation?.artifacts.match).toBeNull();
  });

  test("a failed lake projection blocks the cursor and records no observation", async () => {
    const match = matchNumbered(7005);
    // Occupy the staging directory's path with a plain file so the scaffold's
    // mkdir fails: the real way staging returns false, not a stubbed one.
    await Bun.write(path.join(lakeDir, MATCHES_STAGING_DIR), "not a directory");

    await expect(persist(match)).rejects.toThrow(
      "cursor advancement is blocked",
    );

    // An observation row means the raw payload really did become canonical
    // AND reached the lake, so a blocked pass must leave none.
    expect(
      await getObservation(prisma, {
        matchId: toRiotMatchId(match.metadata.matchId),
      }),
    ).toBeNull();
    // The archive itself happened, so its receipt stands; the projection's
    // does not.
    expect(await receiptKindsFor(match.metadata.matchId)).toEqual([
      "raw-archive-match",
    ]);
    const claim = await prisma.scoutEffectClaim.findUniqueOrThrow({
      where: { key: `raw-match-s3:${match.metadata.matchId}` },
    });
    expect(claim.state).toBe("AMBIGUOUS_OR_FAILED");
  });
});
