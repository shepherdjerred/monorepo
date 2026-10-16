import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { RiotClient } from "#src/league/api/client/riot-client.ts";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { RawMatchSchema } from "@scout-for-lol/data";
import type configuration from "#src/configuration.ts";
import {
  createTestDatabase,
  testDatabaseModule,
} from "#src/testing/test-database.ts";

const { prisma } = createTestDatabase("raw-riot-evidence-outbox");
const io = vi.hoisted(() => ({
  production: false,
  failAfterWrite: false,
  put: vi.fn(
    async (
      _client: unknown,
      _bucket: string,
      object: { key: string; bytes: Uint8Array; digest: string },
    ) => {
      if (object.bytes.length === 0) throw new Error("No raw bytes");
    },
  ),
}));
vi.mock("#src/database/index.ts", async () => await testDatabaseModule(prisma));
vi.mock("#src/configuration/flags.ts", async (original) => ({
  ...(await original()),
  isFeatureHardDisabled: () => io.production,
  isPolicyEnabled: async () => !io.production,
}));
vi.mock("#src/configuration.ts", async (original) => {
  const actual = await original<{ default: typeof configuration }>();
  return {
    ...actual,
    default: { ...actual.default, s3BucketName: "raw-fixture" },
  };
});
vi.mock("#src/storage/s3-client.ts", () => ({
  createS3Client: () => ({ destroy: vi.fn() }),
}));
vi.mock("#src/storage/raw-json.ts", () => ({ putImmutableRawJson: io.put }));
const { captureRiotPayload, captureRiotResponse, reconcileRawRiotPayloads } =
  await import("./raw-riot.ts");
const { callRiotOrUndefined } = await import("#src/league/api/riot-call.ts");
const { resolveResultEvidence } = await import("./results.ts");
const { gameResultFromMatch } =
  await import("#src/scout-client/canonical/riot-result.ts");

beforeEach(async () => {
  io.production = false;
  io.failAfterWrite = false;
  io.put.mockClear();
  await prisma.riotPayloadCapture.deleteMany();
});
afterAll(async () => {
  await prisma.$disconnect();
});

test("unknown and invalid upstream payloads are retained before validation", async () => {
  const payload = {
    future: [0, null, { nested: true }],
    observers: { encryptionKey: "fixture-credential" },
    accessToken: "fixture-token",
  };
  const sdk = new RiotClient({
    apiKey: "fixture",
    onPayload: captureRiotResponse,
    fetchFn: async () => Response.json(payload),
  });
  expect(
    await callRiotOrUndefined(
      {
        source: "raw-fixture",
        schema: z.strictObject({ expected: z.string() }),
        context: { matchId: "NA1_42" },
      },
      async () =>
        await sdk.match.get(RiotMatchIdSchema.parse("NA1_42"), "AMERICAS"),
    ),
  ).toBeUndefined();
  const rows = await prisma.riotPayloadCapture.findMany();
  expect(rows).toHaveLength(1);
  expect(rows[0]?.document).toMatchObject({
    payload: { future: payload.future, observers: {} },
  });
  expect(JSON.stringify(rows[0]?.document)).not.toContain("fixture-token");
  expect(JSON.stringify(rows[0]?.document)).not.toContain("fixture-credential");
  expect(await reconcileRawRiotPayloads()).toBe(1);
  const archived = await prisma.riotPayloadCapture.findFirstOrThrow();
  expect(archived.archiveKey).toMatch(
    /^riot\/observations\/\d{4}\/\d{2}\/\d{2}\//u,
  );
  expect(archived.archiveDigest).toMatch(/^[0-9a-f]{64}$/u);
  expect(archived.archivedAt).not.toBeNull();
});

test("a failed capture cannot be mistaken for an optional upstream outage", async () => {
  const sdk = new RiotClient({
    apiKey: "fixture",
    onPayload: async () => {
      throw new Error("Raw queue unavailable");
    },
    fetchFn: async () => Response.json({ future: true }),
  });
  await expect(
    callRiotOrUndefined(
      { source: "fixture", schema: z.json(), context: {} },
      async () =>
        await sdk.match.get(RiotMatchIdSchema.parse("NA1_42"), "AMERICAS"),
    ),
  ).rejects.toThrow("capture");
});

test("uncertain writes retain their queue identity and exact retry bytes", async () => {
  await captureRiotPayload(
    "timeline",
    { future: { z: 1, a: [null, 0] } },
    { matchId: "NA1_42" },
  );
  io.put.mockRejectedValueOnce(new Error("Write response lost"));
  await expect(reconcileRawRiotPayloads()).rejects.toThrow("remain pending");
  const pending = await prisma.riotPayloadCapture.findFirstOrThrow();
  expect(pending.archivedAt).toBeNull();
  expect(pending.claimId).toBeNull();
  await prisma.riotPayloadCapture.update({
    where: { id: pending.id },
    data: { nextAttemptAt: new Date(0) },
  });
  expect(await reconcileRawRiotPayloads()).toBe(1);
  expect(io.put.mock.calls[0]?.[2]).toEqual(io.put.mock.calls[1]?.[2]);
});

test("a failed archive does not starve other raw payloads", async () => {
  await captureRiotPayload("match", { gameId: 1 }, {});
  await captureRiotPayload("clash", { unknownRoster: [1, 2] }, {});
  io.put.mockRejectedValueOnce(new Error("Object store unavailable"));
  await expect(reconcileRawRiotPayloads()).rejects.toThrow("remain pending");
  expect(
    await prisma.riotPayloadCapture.count({
      where: { archivedAt: { not: null } },
    }),
  ).toBe(1);
});

test("production captures and drains no new raw Riot work", async () => {
  io.production = true;
  await captureRiotPayload("match", { gameId: 1 }, {});
  expect(await reconcileRawRiotPayloads()).toBe(0);
  expect(await prisma.riotPayloadCapture.count()).toBe(0);
  expect(io.put).not.toHaveBeenCalled();
});

test("unselected Riot captures resolve conflicting client scoreboards without invoking effects", async () => {
  const match = RawMatchSchema.parse(
    await Bun.file(
      new URL("../../../../testdata/rift.json", import.meta.url),
    ).json(),
  );
  const base = gameResultFromMatch(match);
  const client = {
    ...base,
    source: "SCOUT_CLIENT" as const,
    sourceId: "client-one",
  };
  const conflicting = {
    ...client,
    sourceId: "client-two",
    participants: client.participants.map((player) => ({
      ...player,
      win: !player.win,
    })),
  };
  const disputed = await resolveResultEvidence(match.metadata.matchId, [
    client,
    conflicting,
  ]);
  expect(disputed.kind).toBe("conflict");
  await captureRiotPayload("match-data", match, {
    matchId: match.metadata.matchId,
  });
  await reconcileRawRiotPayloads();
  const resolved = await resolveResultEvidence(match.metadata.matchId, [
    client,
    conflicting,
  ]);
  expect(resolved).toMatchObject({
    kind: "available",
    value: { source: "RIOT", participants: base.participants },
  });
  expect(await prisma.matchObservation.count()).toBe(0);
  expect(await prisma.scoutEffectClaim.count()).toBe(0);
});
