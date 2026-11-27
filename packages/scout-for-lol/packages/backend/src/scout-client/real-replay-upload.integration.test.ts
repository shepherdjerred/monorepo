import { type GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  RawMatchSchema,
  type DiscordAccountId,
  type LeaguePuuid,
} from "@scout-for-lol/data";
import { ArtifactDescriptorSchema } from "@scout-for-lol/domain/artifacts/descriptors.ts";
import { PublicReplayDescriptorSchema } from "@scout-for-lol/domain/artifacts/public-replay.ts";
import { normalizeGameBuild } from "@scout-for-lol/domain/artifacts/replay-transport.mjs";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { expect, test, vi } from "vitest";
import { z } from "zod";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { createTestScoutClientDevice } from "#src/testing/scout-client-device.ts";
import {
  createTestDatabase,
  dropTestDatabase,
} from "#src/testing/test-database.ts";
import { secretDigest } from "./secrets.ts";

const outboxPath = Bun.env["SCOUT_REPLAY_PROOF_OUTBOX"];
const replayDirectory = Bun.env["SCOUT_REPLAY_PROOF_DIRECTORY"];
const handoffPath = Bun.env["SCOUT_REPLAY_PROOF_HANDOFF"];
const replayGames = Bun.env["SCOUT_REPLAY_PROOF_GAMES"];
const canonicalMatchPath = Bun.env["SCOUT_REPLAY_PROOF_CANONICAL_MATCH"];
const ownerChampion = Bun.env["SCOUT_REPLAY_PROOF_OWNER_CHAMPION"];
const handoffReleasePath = "/__replay_proof";
const handoffWindowMs = 120_000;
const ReplayGamesSchema = z
  .array(
    z.object({
      gameId: z.string().regex(/^[1-9]\d*$/u),
      durationSeconds: z.number().positive(),
      queueId: z.number().int().positive().default(710),
    }),
  )
  .nonempty()
  .refine(
    (games) => new Set(games.map(({ gameId }) => gameId)).size === games.length,
    "Replay proof game IDs must be unique",
  );
const RecoverySchema = z.object({
  observer: z.uuid(),
  body: z.string().transform((body) => {
    const parsed: unknown = JSON.parse(body);
    return z
      .looseObject({ gameVersion: z.string(), queueId: z.number() })
      .parse(parsed);
  }),
});

function readRecoveredMatch(outbox: string, gameId: string) {
  const database = new Database(outbox, { readonly: true });
  try {
    return RecoverySchema.parse(
      database
        .query(
          `
      SELECT observer, CAST(full_game AS TEXT) AS body
      FROM game_recovery
      WHERE platform = 'NA1' AND game_id = ? AND full_game IS NOT NULL
    `,
        )
        .get(gameId),
    );
  } finally {
    database.close();
  }
}

/** Keeps replay bytes in a private scratch directory while preserving the SDK command contract. */
function scratchReplayStore(
  directory: string,
  canonical?: { key: string; text: string },
) {
  const metadata = new Map<string, Record<string, string>>();
  return {
    async send(command: GetObjectCommand | PutObjectCommand) {
      if (
        canonical &&
        !(command instanceof PutObjectCommand) &&
        command.input.Key === canonical.key
      ) {
        return { Body: { transformToString: async () => canonical.text } };
      }
      const key = z
        .string()
        .regex(/^replays\/NA1\/\d+\/[a-f0-9]{64}\.rofl$/u)
        .parse(command.input.Key);
      const filePath = path.join(directory, path.basename(key));
      if (command instanceof PutObjectCommand) {
        const stream = z.instanceof(Readable).parse(command.input.Body);
        await Bun.write(filePath, await buffer(stream));
        metadata.set(key, command.input.Metadata ?? {});
        return {};
      }
      const file = Bun.file(filePath);
      const totalBytes = file.size;
      const range = command.input.Range?.match(/^bytes=(\d+)-(\d+)$/u);
      const start = Number(range?.[1] ?? 0);
      const end = Number(range?.[2] ?? totalBytes - 1);
      return {
        Body: {
          transformToWebStream: () => file.slice(start, end + 1).stream(),
        },
        Metadata: metadata.get(key),
        ContentLength: end - start + 1,
        ...(range === undefined
          ? {}
          : {
              ContentRange: `bytes ${start.toString()}-${end.toString()}/${totalBytes.toString()}`,
            }),
      };
    },
  };
}

async function handOffReplays(
  receiptPath: string,
  origin: string,
  replayIds: Readonly<Record<string, string>>,
  released: Promise<undefined>,
) {
  await Bun.write(receiptPath, JSON.stringify({ origin, replayIds }));
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      released,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error(
                "Browser replay proof did not release the local backend",
              ),
            ),
          handoffWindowMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function createPairedUploader(
  prisma: ExtendedPrismaClient,
  ownerId: DiscordAccountId,
  puuid: LeaguePuuid,
) {
  const deviceId = await createTestScoutClientDevice(prisma, ownerId);
  const token = `sct_${crypto.randomUUID()}`;
  await prisma.scoutClientDevice.update({
    where: { id: deviceId },
    data: { tokenDigest: secretDigest(token) },
  });
  const accountMetadata = {
    serverId: DiscordGuildIdSchema.parse("190000000000000002"),
    creatorDiscordId: ownerId,
    createdTime: new Date(),
    updatedTime: new Date(),
    alias: "replay-proof",
  };
  await prisma.player.create({
    data: {
      ...accountMetadata,
      discordId: ownerId,
      accounts: {
        create: { ...accountMetadata, puuid, region: "AMERICA_NORTH" },
      },
    },
  });
  return { deviceId, puuid, token };
}

async function readCanonicalProof(
  matchPath: string,
  champion: string,
  game: z.infer<typeof ReplayGamesSchema>[number],
  directory: string,
) {
  const { matchObjectKey } = await import("#src/report-store/s3-raw-source.ts");
  const text = await Bun.file(matchPath).text();
  const match = RawMatchSchema.parse(JSON.parse(text));
  const matchId = RiotMatchIdSchema.parse(`NA1_${game.gameId}`);
  expect(match.metadata.matchId).toBe(matchId);
  expect(match.info.gameId.toString()).toBe(game.gameId);
  expect(match.info.queueId).toBe(game.queueId);
  const owners = match.info.participants.filter(
    (member) => member.championName === champion,
  );
  const owner = owners.length === 1 ? owners[0] : undefined;
  if (!owner) throw new Error("Canonical proof needs a unique owner champion");
  const replay = Bun.file(path.join(directory, `NA1-${game.gameId}.rofl`));
  const bytes = Buffer.from(await replay.arrayBuffer());
  const footerLength = bytes.readUInt32LE(bytes.length - 4);
  if (
    footerLength <= 0 ||
    footerLength > 4 * 1024 * 1024 ||
    footerLength > bytes.length - 4
  )
    throw new Error("Invalid replay footer length");
  const { statsJson } = z
    .object({ statsJson: z.string() })
    .parse(JSON.parse(bytes.subarray(-4 - footerLength, -4).toString("utf8")));
  const footerRows = z
    .array(
      z.object({
        PUUID: z.string(),
        RIOT_ID_GAME_NAME: z.string(),
        RIOT_ID_TAG_LINE: z.string(),
        SKIN: z.string(),
        TEAM: z.string(),
        CHAMPIONS_KILLED: z.string(),
        NUM_DEATHS: z.string(),
        ASSISTS: z.string(),
      }),
    )
    .parse(JSON.parse(statsJson));
  const rows = footerRows.filter(
    (row) =>
      row.RIOT_ID_GAME_NAME === owner.riotIdGameName &&
      row.RIOT_ID_TAG_LINE === owner.riotIdTagline &&
      row.SKIN === owner.championName &&
      row.TEAM === owner.teamId.toString() &&
      row.CHAMPIONS_KILLED === owner.kills.toString() &&
      row.NUM_DEATHS === owner.deaths.toString() &&
      row.ASSISTS === owner.assists.toString(),
  );
  const row = rows.length === 1 ? rows[0] : undefined;
  if (!row)
    throw new Error("Canonical owner cannot be joined to the replay footer");
  const archive = ArtifactDescriptorSchema.parse({
    kind: "match",
    key: matchObjectKey(matchId, new Date(match.info.gameCreation)),
    bytes: Buffer.byteLength(text),
    digest: new Bun.CryptoHasher("sha256").update(text).digest("hex"),
    contentType: "application/json",
    capturedAt: new Date().toISOString(),
  });
  return {
    archive,
    text,
    matchId,
    gameVersion: match.info.gameVersion,
    puuid: LeaguePuuidSchema.parse(owner.puuid),
    alias: {
      lcuUuid: z.uuid().parse(row.PUUID),
      gameName: row.RIOT_ID_GAME_NAME,
      tagLine: row.RIOT_ID_TAG_LINE,
    },
  };
}

async function readConfiguredCanonicalProof(
  games: z.infer<typeof ReplayGamesSchema>,
  directory: string,
) {
  const canonicalGame = games.length === 1 ? games[0] : undefined;
  if (canonicalMatchPath !== undefined && (!canonicalGame || !ownerChampion))
    throw new Error(
      "Canonical replay proof requires one game and SCOUT_REPLAY_PROOF_OWNER_CHAMPION",
    );
  return canonicalMatchPath !== undefined && canonicalGame && ownerChampion
    ? await readCanonicalProof(
        canonicalMatchPath,
        ownerChampion,
        canonicalGame,
        directory,
      )
    : undefined;
}

async function seedCanonicalProof(
  prisma: ExtendedPrismaClient,
  canonical: NonNullable<
    Awaited<ReturnType<typeof readConfiguredCanonicalProof>>
  >,
) {
  const { rawArchiveReceiptRecord } =
    await import("#src/report-lake/durable-receipts.ts");
  const { recordReceipt } =
    await import("#src/database/durable/receipt-repository.ts");
  expect(
    await recordReceipt(
      prisma,
      rawArchiveReceiptRecord({
        matchId: canonical.matchId,
        artifact: canonical.archive,
      }),
    ),
  ).toEqual({ outcome: "applied" });
  await prisma.leagueIdentityAlias.create({
    data: {
      ...canonical.alias,
      puuid: canonical.puuid,
      source: "riot_id",
      ownerVerified: true,
    },
  });
}

async function seedOutboxProof(
  prisma: ExtendedPrismaClient,
  {
    deviceId,
    puuid,
  }: Pick<
    Awaited<ReturnType<typeof createPairedUploader>>,
    "deviceId" | "puuid"
  >,
  {
    gameId,
    queueId,
  }: Pick<z.infer<typeof ReplayGamesSchema>[number], "gameId" | "queueId">,
  sequence: number,
) {
  if (outboxPath === undefined)
    throw new Error("Replay proof outbox is missing");
  const { observer, body } = readRecoveredMatch(outboxPath, gameId);
  expect(body.queueId).toBe(queueId);
  await prisma.leagueIdentityAlias.upsert({
    where: { lcuUuid: observer },
    create: {
      lcuUuid: observer,
      puuid,
      gameName: "fixture",
      tagLine: "NA1",
      // Seed the only valid stored alias source in the isolated database.
      source: "riot_id",
      ownerVerified: true,
    },
    update: {},
  });
  await prisma.scoutClientObservation.create({
    data: {
      observationId: crypto.randomUUID(),
      deviceId,
      sequence: BigInt(sequence + 1),
      capturedAt: new Date(),
      protocolVersion: 1,
      schemaVersion: 1,
      appVersion: "0.1.0",
      kind: "post_game",
      leaguePatch: body.gameVersion,
      platformId: "NA1",
      gameId,
      localPuuid: puuid,
      localLcuUuid: observer,
      payload: {
        resource: "post_game",
        data: z.json().parse(body),
      },
      bodyDigest: new Bun.CryptoHasher("sha256")
        .update(JSON.stringify(body))
        .digest("hex"),
      disposition: "ACCEPTED",
    },
  });
  return body.gameVersion;
}

test.skipIf(
  replayDirectory === undefined ||
    replayGames === undefined ||
    (outboxPath === undefined && canonicalMatchPath === undefined),
)(
  "the saved desktop matches upload and serve the original replay on anonymous routes",
  async () => {
    if (replayDirectory === undefined || replayGames === undefined)
      throw new Error("Replay proof inputs are missing");
    const games = ReplayGamesSchema.parse(JSON.parse(replayGames));
    const canonical = await readConfiguredCanonicalProof(
      games,
      replayDirectory,
    );
    const objectDirectory = await mkdtemp(
      path.join(tmpdir(), "scout-replay-proof-"),
    );
    try {
      const { prisma, dbPath } = createTestDatabase("real_replay_upload");
      try {
        vi.doMock("#src/database/index.ts", async (importOriginal) => ({
          ...(await importOriginal()),
          prisma,
        }));
        const store = scratchReplayStore(
          objectDirectory,
          canonical && { key: canonical.archive.key, text: canonical.text },
        );
        vi.doMock("#src/storage/s3-client.ts", () => ({
          createS3Client: () => store,
        }));
        const ownerId = DiscordAccountIdSchema.parse("190000000000000001");
        vi.stubEnv("ENVIRONMENT", "dev");
        if (canonical) vi.stubEnv("S3_BUCKET_NAME", "local-replay-proof");
        vi.doMock("#src/configuration/flags.ts", async (importOriginal) => ({
          ...(await importOriginal()),
          isPolicyEnabled: async (key: string, attributes: { user?: string }) =>
            key === "scout_client_ingestion" && attributes.user === ownerId,
        }));
        const { handleScoutClientRoute } = await import("./http.ts");
        const { handleReplayRoute } = await import("#src/replays/http.ts");
        const { resolveReplaySupport } =
          await import("#src/replays/support.ts");
        const { deviceId, puuid, token } = await createPairedUploader(
          prisma,
          ownerId,
          canonical?.puuid ?? LeaguePuuidSchema.parse("p".repeat(78)),
        );
        if (canonical) await seedCanonicalProof(prisma, canonical);

        const handoff = Promise.withResolvers<undefined>();
        const server = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch: async (request) => {
            const url = new URL(request.url);
            if (
              handoffPath !== undefined &&
              url.pathname === handoffReleasePath &&
              request.method === "DELETE"
            ) {
              handoff.resolve(undefined);
              return new Response(null, { status: 204 });
            }
            return (
              (await handleScoutClientRoute(request, url)) ??
              (await handleReplayRoute(request, url, resolveReplaySupport)) ??
              new Response(null, { status: 404 })
            );
          },
        });
        try {
          const replayIds: Record<string, string> = {};
          for (const [
            sequence,
            { gameId, durationSeconds, queueId },
          ] of games.entries()) {
            const gameVersion =
              canonical?.gameVersion ??
              (await seedOutboxProof(
                prisma,
                { deviceId, puuid },
                { gameId, queueId },
                sequence,
              ));
            const file = Bun.file(
              path.join(replayDirectory, `NA1-${gameId}.rofl`),
            );
            const sha256 = new Bun.CryptoHasher("sha256")
              .update(await file.arrayBuffer())
              .digest("hex");
            const uploadUrl = new URL(
              `/api/scout-client/v1/replays/${gameId}`,
              server.url,
            );
            const headers = {
              "Content-Type": "application/vnd.riot.rofl",
              "Content-Length": file.size.toString(),
              "X-Scout-SHA256": sha256,
              "X-Scout-Platform": "NA1",
            };
            const anonymousUpload = await fetch(uploadUrl, {
              method: "PUT",
              headers,
              body: file,
            });
            expect(anonymousUpload.status).toBe(401);
            const upload = await fetch(uploadUrl, {
              method: "PUT",
              headers: { ...headers, Authorization: `Bearer ${token}` },
              body: file,
            });
            expect(upload.status, await upload.clone().text()).toBe(201);
            const matchQuery = await fetch(
              new URL(
                `/api/replays?platformId=NA1&gameId=${gameId}`,
                server.url,
              ),
            );
            expect(matchQuery.status).toBe(200);
            const { replay } = z
              .object({ replay: PublicReplayDescriptorSchema })
              .parse(await matchQuery.json());
            expect(replay).toMatchObject({
              gameId,
              sha256,
              bytes: file.size,
              gameBuild: normalizeGameBuild(gameVersion),
              protocol: "8bbfcd5af2bc92db",
              durationSeconds,
              mapId: 11,
              gameMode: "CLASSIC",
              teamSizes: [5, 5],
              playback: {
                status: "support_preparing",
                reason: "patch_unobserved",
              },
            });
            const descriptorUrl = new URL(
              `/api/replays/${replay.replayId}`,
              server.url,
            );
            const descriptor = await fetch(descriptorUrl);
            expect(descriptor.status).toBe(200);
            expect(await descriptor.json()).toEqual(replay);
            const contentUrl = new URL(
              `${descriptorUrl.pathname}/content`,
              server.url,
            );
            const content = await fetch(contentUrl);
            expect(content.status).toBe(200);
            expect(content.headers.get("etag")).toBe(`"${sha256}"`);
            expect(
              new Bun.CryptoHasher("sha256")
                .update(await content.arrayBuffer())
                .digest("hex"),
            ).toBe(sha256);
            const range = await fetch(contentUrl, {
              headers: { Range: "bytes=0-3" },
            });
            expect(range.status).toBe(206);
            expect(await range.text()).toBe("RIOT");
            replayIds[gameId] = replay.replayId;
          }
          if (handoffPath !== undefined)
            await handOffReplays(
              handoffPath,
              server.url.origin,
              replayIds,
              handoff.promise,
            );
        } finally {
          await server.stop();
        }
      } finally {
        vi.unstubAllEnvs();
        await dropTestDatabase(prisma, dbPath);
      }
    } finally {
      await rm(objectDirectory, { recursive: true });
    }
  },
  60_000 + handoffWindowMs,
);
