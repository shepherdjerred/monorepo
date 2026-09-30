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
  await expect(decideReplayOffer("123", OFFER, DEVICE)).resolves.toMatchObject({
    decision: "want",
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

test("never wants a replay it already rejected", async () => {
  mocks.artifactFindUnique.mockResolvedValue({
    uploadState: "REJECTED",
    gameId: "123",
    lastError: "Replay does not have a ROFL header",
  });

  await expect(decideReplayOffer("123", OFFER, DEVICE)).resolves.toMatchObject({
    decision: "never",
    reason: "Replay does not have a ROFL header",
  });
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
