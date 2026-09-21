import { beforeEach, expect, test, vi } from "vitest";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import type { AuthenticatedScoutClient } from "./authentication.ts";
import { REPLAY_UPLOAD_LEASE_MS } from "./replay-lease.ts";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  send: vi.fn(),
}));

vi.mock("#src/configuration.ts", () => ({
  default: { s3BucketName: "replay-test" },
}));

vi.mock("#src/database/index.ts", () => ({
  prisma: {
    scoutClientObservation: { findFirst: mocks.findFirst },
    scoutClientReplayArtifact: {
      create: mocks.create,
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
    },
  },
}));

vi.mock("#src/storage/s3-client.ts", () => ({
  createS3Client: () => ({ send: mocks.send }),
}));

const { uploadReplay } = await import("./replay-upload.ts");

const DEVICE: AuthenticatedScoutClient = {
  deviceId: "9d1e9752-b938-4293-8466-21cb523410a5",
  ownerId: DiscordAccountIdSchema.parse("160509172704739328"),
  appVersion: "0.1.0",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findFirst.mockResolvedValue({ observationId: "observed" });
  mocks.send.mockResolvedValue({});
});

test("atomically reclaims a replay upload whose lease expired", async () => {
  const body = new TextEncoder().encode("RIOT-replay");
  const digest = new Bun.CryptoHasher("sha256").update(body).digest("hex");
  const staleAt = new Date(Date.now() - REPLAY_UPLOAD_LEASE_MS - 1);
  const stale = {
    uploadState: "UPLOADING",
    digest,
    bytes: BigInt(body.byteLength),
    updatedAt: staleAt,
  };
  mocks.findUnique
    .mockResolvedValueOnce(stale)
    .mockResolvedValueOnce(stale)
    .mockResolvedValueOnce({ id: "artifact-id" });
  mocks.create.mockRejectedValue({ code: "P2002" });
  mocks.updateMany.mockResolvedValue({ count: 1 });
  const request = new Request(
    "https://scout.invalid/api/scout-client/v1/replays/123",
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/vnd.riot.rofl",
        "Content-Length": body.byteLength.toString(),
        "X-Scout-SHA256": digest,
      },
      body,
    },
  );

  await expect(uploadReplay(request, "123", DEVICE)).resolves.toEqual({
    outcome: "accepted",
    digest,
    bytes: body.byteLength,
  });

  expect(mocks.updateMany).toHaveBeenCalledTimes(2);
  expect(mocks.updateMany).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      where: expect.objectContaining({
        digest,
        OR: expect.arrayContaining([
          expect.objectContaining({ uploadState: "UPLOADING" }),
        ]),
      }),
      data: expect.objectContaining({ uploadState: "UPLOADING" }),
    }),
  );
  expect(mocks.updateMany).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      where: expect.objectContaining({
        id: "artifact-id",
        uploadState: "UPLOADING",
      }),
      data: expect.objectContaining({ uploadState: "COMPLETED" }),
    }),
  );
});
