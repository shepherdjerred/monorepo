import {
  CanonicalMatchRecordSchema,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { LeaguePuuid } from "@scout-for-lol/domain/identity/league-account.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { listStagingFiles } from "#src/report-lake/staging.ts";

/**
 * Doubles for integration tests that run match archiving and history
 * recovery against real rows: an in-memory S3 transport keyed like the real
 * one, the archived canonical record read back from it, and the rows a test
 * resets and seeds.
 */

type SaveConfig = {
  matchId: RiotMatchId;
  assetType: string;
  extension: string;
  body: string;
  contentType: string;
};

/** Content-addressed puts into `objects`, and verified reads back from it. */
export function inMemoryS3(objects: Map<string, string>, bucket: string) {
  return {
    saveToS3: (config: SaveConfig) => {
      const body = config.body;
      const key = `games/${config.matchId}/${config.assetType}.${config.extension}`;
      objects.set(key, body);
      return Promise.resolve({
        key,
        digest: new Bun.CryptoHasher("sha256").update(body).digest("hex"),
        bytes: new TextEncoder().encode(body).byteLength,
        contentType: config.contentType,
        capturedAt: new Date().toISOString(),
        url: `s3://${bucket}/${key}`,
      });
    },
    readVerifiedRawObjectText: (args: { key: string }) => {
      const body = objects.get(args.key);
      return body === undefined
        ? Promise.reject(new Error(`No object at ${args.key}`))
        : Promise.resolve(body);
    },
  };
}

/** The archived canonical document, as a reader of `games/` parses it. */
export function archivedRecordIn(objects: ReadonlyMap<string, string>) {
  const [body] = [...objects.entries()]
    .filter(([key]) => key.endsWith("/match.json"))
    .map(([, value]) => value);
  if (body === undefined) throw new Error("Nothing was archived");
  return CanonicalMatchRecordSchema.parse(JSON.parse(body));
}

/** Every row a match-pipeline test writes, children first. */
export async function clearMatchPipelineRows(
  prisma: ExtendedPrismaClient,
): Promise<void> {
  await prisma.$transaction([
    prisma.matchNotificationIntent.deleteMany(),
    prisma.matchReportSnapshot.deleteMany(),
    prisma.matchResultEvidence.deleteMany(),
    prisma.matchTrackedAccount.deleteMany(),
    prisma.matchProcessingReceipt.deleteMany(),
    prisma.matchObservation.deleteMany(),
    prisma.matchEvidenceAdmission.deleteMany(),
    prisma.scoutClientCanonicalMatch.deleteMany(),
    prisma.scoutClientObservation.deleteMany(),
    prisma.scoutClientDevice.deleteMany(),
    prisma.scoutClientPairing.deleteMany(),
    prisma.account.deleteMany(),
    prisma.player.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

/** A tracked player in one guild with one North American account. */
export async function createTrackedPlayer(
  prisma: ExtendedPrismaClient,
  input: {
    readonly alias: string;
    readonly owner: DiscordAccountId;
    readonly guild: DiscordGuildId;
    readonly puuid: LeaguePuuid;
  },
): Promise<void> {
  const now = new Date();
  const shared = {
    alias: input.alias,
    serverId: input.guild,
    creatorDiscordId: input.owner,
    createdTime: now,
    updatedTime: now,
  };
  await prisma.player.create({
    data: {
      ...shared,
      discordId: input.owner,
      accounts: {
        create: { ...shared, puuid: input.puuid, region: "AMERICA_NORTH" },
      },
    },
  });
}

/** Every staged `matches` row (JSON Lines files) in a lake directory. */
export async function stagedMatchRows(lakeDir: string): Promise<unknown[]> {
  const files = await listStagingFiles(lakeDir, "matches");
  const texts = await Promise.all(
    files.map(async (file) => await Bun.file(file).text()),
  );
  return texts
    .flatMap((text) => text.split("\n"))
    .filter((line) => line.trim().length > 0)
    .map((line): unknown => JSON.parse(line));
}
