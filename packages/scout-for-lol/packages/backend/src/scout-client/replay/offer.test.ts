import { beforeEach, expect, test, vi } from "vitest";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import type { AuthenticatedScoutClient } from "#src/scout-client/authentication.ts";

const mocks = vi.hoisted(() => ({
  artifactFindUnique: vi.fn(),
  resolveProvenance: vi.fn(),
}));

vi.mock("#src/database/index.ts", () => ({
  prisma: {
    scoutClientReplayArtifact: { findUnique: mocks.artifactFindUnique },
  },
}));

vi.mock("./evidence.ts", () => ({
  resolveReplayProvenance: mocks.resolveProvenance,
}));

const { decideReplayOffer } = await import("./offer.ts");

const DEVICE: AuthenticatedScoutClient = {
  deviceId: "9d1e9752-b938-4293-8466-21cb523410a5",
  ownerId: DiscordAccountIdSchema.parse("160509172704739328"),
  appVersion: "0.1.0",
};
const OFFER = { digest: "a".repeat(64), bytes: 20_000_000 } as const;
const PROVENANCE = {
  platformId: "NA1",
  localPuuid: "p".repeat(78),
  leaguePatch: "16.18.817.5716",
  gameDurationSeconds: 60,
  participant: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.artifactFindUnique.mockResolvedValue(null);
  mocks.resolveProvenance.mockResolvedValue(PROVENANCE);
});

test("wants a replay the server can vouch for", async () => {
  await expect(decideReplayOffer("123", OFFER, DEVICE)).resolves.toEqual({
    decision: "want",
    reason: "Evidence is on file",
  });
});

test("already has a completed replay", async () => {
  mocks.artifactFindUnique.mockResolvedValue({
    uploadState: "COMPLETED",
    gameId: "123",
    lastError: null,
  });

  await expect(decideReplayOffer("123", OFFER, DEVICE)).resolves.toMatchObject({
    decision: "have",
  });
});

test.each([
  "Replay does not have a ROFL header",
  "Replay chunk is too short for a Zstandard frame",
  "Replay chunk is missing its Zstandard frame marker",
  "Replay chunk compression is invalid: additional detail",
  null,
])("never wants a replay rejected with %s", async (lastError) => {
  mocks.artifactFindUnique.mockResolvedValue({
    uploadState: "REJECTED",
    gameId: "123",
    lastError,
  });

  await expect(decideReplayOffer("123", OFFER, DEVICE)).resolves.toMatchObject({
    decision: "never",
    reason: lastError ?? "Replay was rejected",
  });
  expect(mocks.resolveProvenance).not.toHaveBeenCalled();
});

test("offers a legacy compression rejection again once match evidence is available", async () => {
  mocks.artifactFindUnique.mockResolvedValue({
    uploadState: "REJECTED",
    gameId: "123",
    platformId: "NA1",
    lastError: "Replay chunk compression is invalid",
  });
  mocks.resolveProvenance.mockResolvedValueOnce(null);
  const offer = { ...OFFER, platformId: "NA1" };
  await expect(decideReplayOffer("123", offer, DEVICE)).resolves.toEqual({
    decision: "later",
    reason: "No match evidence yet from this account's clients or from Riot",
  });
  await expect(decideReplayOffer("123", offer, DEVICE)).resolves.toEqual({
    decision: "want",
    reason: "Evidence is on file",
    retryLegacyCompressionRejection: true,
  });
  await expect(decideReplayOffer("456", offer, DEVICE)).resolves.toMatchObject({
    decision: "never",
  });
  await expect(
    decideReplayOffer("123", { ...offer, platformId: "EUW1" }, DEVICE),
  ).resolves.toMatchObject({ decision: "never" });
  expect(mocks.resolveProvenance).toHaveBeenCalledTimes(2);
  mocks.resolveProvenance.mockResolvedValueOnce({
    ...PROVENANCE,
    platformId: "EUW1",
  });
  await expect(decideReplayOffer("123", OFFER, DEVICE)).resolves.toEqual({
    decision: "never",
    reason: "This replay is stored against a different platform",
  });
});

test("a stored digest cannot be offered against a different platform", async () => {
  mocks.artifactFindUnique.mockResolvedValue({
    uploadState: "COMPLETED",
    gameId: "123",
    platformId: "NA1",
    lastError: null,
  });
  await expect(
    decideReplayOffer("123", { ...OFFER, platformId: "EUW1" }, DEVICE),
  ).resolves.toMatchObject({ decision: "never" });
});

test("never wants a digest already stored against another game", async () => {
  mocks.artifactFindUnique.mockResolvedValue({
    uploadState: "COMPLETED",
    gameId: "456",
    lastError: null,
  });

  await expect(decideReplayOffer("123", OFFER, DEVICE)).resolves.toMatchObject({
    decision: "never",
  });
});

test("asks again later when nothing can vouch for the game yet", async () => {
  // Not "never": Riot may still archive the match, and another of this
  // owner's clients may still report it. The client bounds its own retries.
  mocks.resolveProvenance.mockResolvedValue(null);

  await expect(decideReplayOffer("123", OFFER, DEVICE)).resolves.toMatchObject({
    decision: "later",
  });
});

test("decides without ever reading the replay", async () => {
  // The whole point: a refusal costs one small round trip instead of a
  // multi-megabyte upload rejected three database reads in.
  await decideReplayOffer("123", OFFER, DEVICE);
  expect(mocks.resolveProvenance).toHaveBeenCalledWith(
    { gameId: "123", platformId: null },
    DEVICE,
  );
});

test("passes the client's platform through when it knows it", async () => {
  await decideReplayOffer("123", { ...OFFER, platformId: "NA1" }, DEVICE);
  expect(mocks.resolveProvenance).toHaveBeenCalledWith(
    { gameId: "123", platformId: "NA1" },
    DEVICE,
  );
});
