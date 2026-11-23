import { beforeEach, expect, test, vi } from "vitest";
import {
  PublicReplayAvailabilitySchema,
  PublicReplayDescriptorSchema,
} from "@scout-for-lol/domain/artifacts/public-replay.ts";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  send: vi.fn(),
}));
vi.mock("#src/database/index.ts", () => ({
  prisma: {
    scoutClientReplayArtifact: {
      findFirst: mocks.findFirst,
      findMany: mocks.findMany,
    },
  },
}));
vi.mock("#src/configuration.ts", () => ({
  default: { s3BucketName: "private" },
}));
vi.mock("#src/storage/s3-client.ts", () => ({
  createS3Client: () => ({ send: mocks.send }),
}));

const { handleReplayRoute, parseReplayRange } = await import("./http.ts");
const { findPublicMatchReplays, findPublicReplay } =
  await import("./catalog.ts");
const { openReplayContent, boundedReplayStream, ReplayContentUnavailable } =
  await import("./content.ts");

const replayId = "58001d3b-f679-4bb6-9b3d-314900818b27";
const replay = {
  id: replayId,
  platformId: "NA1",
  gameId: "123",
  digest: "a".repeat(64),
  objectKey: "private-replay-key",
  bytes: 10n,
  gameBuild: "16.21.829.8620",
  protocol: "20e09df23c66b85e",
  durationSeconds: 60,
  mapId: 11,
  gameMode: "CLASSIC",
  teamSizes: [5, 5],
};
const findById = vi.fn();
const findByMatch = vi.fn();
const openContent = vi.fn();
const readTimeline = vi.fn();
const deps = { findById, findByMatch, openContent, readTimeline };

async function request(path: string, init?: RequestInit) {
  const req = new Request(`https://scout.test${path}`, init);
  return await handleReplayRoute(req, new URL(req.url), undefined, deps);
}

beforeEach(() => {
  vi.clearAllMocks();
  findById.mockResolvedValue(replay);
  findByMatch.mockResolvedValue([replay]);
  readTimeline.mockResolvedValue(null);
  openContent.mockImplementation(async (_replay, range) => {
    await Promise.resolve();
    return new Blob([
      new Uint8Array(range === null ? 10 : range.end - range.start + 1),
    ]).stream();
  });
});

test("the timeline endpoint reads evidence only for completed replay lookups", async () => {
  const path = `/api/replays/${replayId}/timeline`;
  const response = await request(path);
  expect(response?.status).toBe(200);
  expect(await response?.json()).toEqual({ timeline: null });
  expect(response?.headers.get("Cache-Control")).toBe("no-store");
  expect(readTimeline).toHaveBeenCalledOnce();
  expect(readTimeline).toHaveBeenCalledWith(replay, expect.any(AbortSignal));

  const head = await request(path, { method: "HEAD" });
  expect(head?.status).toBe(200);
  expect(head?.body).toBeNull();
  findById.mockResolvedValue(null);
  const missing = await request(path);
  expect(missing?.status).toBe(404);
  expect(readTimeline).toHaveBeenCalledOnce();
});

test("anonymous metadata is an explicit safe projection and does not claim a runtime", async () => {
  findById.mockResolvedValue({
    ...replay,
    deviceId: "secret-device",
    ownerId: "private-owner",
    lastError: "private error",
  });
  const response = await request(`/api/replays/${replayId}`);
  expect(response?.status).toBe(200);
  const body = await response?.json();
  expect(body).toEqual({
    replayId,
    platformId: "NA1",
    gameId: "123",
    matchId: "NA1_123",
    bytes: 10,
    sha256: replay.digest,
    gameBuild: replay.gameBuild,
    protocol: replay.protocol,
    durationSeconds: 60,
    mapId: 11,
    gameMode: "CLASSIC",
    teamSizes: [5, 5],
    playback: {
      status: "support_preparing",
      latestPatch: null,
      reason: "patch_unobserved",
    },
  });
  expect(JSON.stringify(body)).not.toMatch(
    /private|secret|objectKey|deviceId|ownerId|lastError/,
  );
  expect(response?.headers.get("Cache-Control")).toBe("no-store");
});

test("admitted support resolver supplies real manifest identity", async () => {
  const req = new Request(`https://scout.test/api/replays/${replayId}`);
  const response = await handleReplayRoute(
    req,
    new URL(req.url),
    async () => ({
      status: "available",
      latestPatch: "16.21",
      package: {
        url: "/replay-assets/build/manifest.json",
        sha256: "b".repeat(64),
      },
    }),
    deps,
  );
  expect(
    PublicReplayDescriptorSchema.parse(await response?.json()).playback.status,
  ).toBe("available");
});

test("legacy missing metadata and unknown platform retain distinct statuses", async () => {
  findById.mockResolvedValue({
    ...replay,
    gameBuild: null,
    protocol: null,
    durationSeconds: null,
  });
  const missingMetadata = await request(`/api/replays/${replayId}`);
  expect(
    PublicReplayDescriptorSchema.parse(await missingMetadata?.json()).playback
      .status,
  ).toBe("metadata_pending");
  findById.mockResolvedValue({ ...replay, platformId: null });
  const unqualified = await request(`/api/replays/${replayId}`);
  expect(
    PublicReplayDescriptorSchema.parse(await unqualified?.json()).playback,
  ).toMatchObject({ reason: "unqualified_platform" });
});

test("match lookup requires a qualified identity, rejects duplicate parameters, and permits absence", async () => {
  const missingPlatform = await request("/api/replays?gameId=123");
  expect(missingPlatform?.status).toBe(400);
  const duplicate = await request(
    "/api/replays?platformId=NA1&gameId=123&gameId=456",
  );
  expect(duplicate?.status).toBe(400);
  findByMatch.mockResolvedValue([]);
  const absent = await request("/api/replays?platformId=NA1&gameId=123");
  expect(await absent?.json()).toEqual({ replay: null });
  expect(findByMatch).toHaveBeenCalledWith("NA1", "123");
});

test("match lookup chooses the newest compatible file rather than a newer unsupported upload", async () => {
  const compatibleId = "58001d3b-f679-4bb6-9b3d-314900818b28";
  findByMatch.mockResolvedValue([replay, { ...replay, id: compatibleId }]);
  const req = new Request(
    "https://scout.test/api/replays?platformId=NA1&gameId=123",
  );
  const response = await handleReplayRoute(
    req,
    new URL(req.url),
    async (identity) =>
      identity.replayId === compatibleId
        ? {
            status: "available",
            latestPatch: "16.21",
            package: {
              url: "/replay-assets/manifest.json",
              sha256: "b".repeat(64),
            },
          }
        : {
            status: "incompatible",
            latestPatch: "16.21",
            reason: "unsupported_build",
          },
    deps,
  );
  expect(
    PublicReplayAvailabilitySchema.parse(await response?.json()).replay
      ?.replayId,
  ).toBe(compatibleId);
});

test("missing and malformed identifiers cannot read content", async () => {
  const malformed = await request("/api/replays/bad/content");
  expect(malformed?.status).toBe(404);
  expect(findById).not.toHaveBeenCalled();
  findById.mockResolvedValue(null);
  const absent = await request(`/api/replays/${replayId}/content`);
  expect(absent?.status).toBe(404);
  expect(openContent).not.toHaveBeenCalled();
  const wrongMethod = await request(`/api/replays/${replayId}`, {
    method: "POST",
  });
  expect(wrongMethod?.status).toBe(405);
});

test("original bytes can be read independently of renderer support", async () => {
  const response = await request(`/api/replays/${replayId}/content`);
  expect(response?.status).toBe(200);
  expect(response?.headers.get("Content-Length")).toBe("10");
  expect(response?.headers.get("ETag")).toBe(`"${replay.digest}"`);
  const bytes = await response?.arrayBuffer();
  expect(bytes?.byteLength).toBe(10);
});

test("temporary storage failures have a sanitized typed response", async () => {
  openContent.mockRejectedValue(
    new ReplayContentUnavailable("private service detail"),
  );
  const response = await request(`/api/replays/${replayId}/content`);
  expect(response?.status).toBe(503);
  expect(await response?.json()).toEqual({
    error: "replay_storage_unavailable",
  });
  expect(response?.headers.get("Cache-Control")).toBe("no-store");
});

test("range, suffix, unsatisfiable, conditional and HEAD responses avoid unwanted reads", async () => {
  const partial = await request(`/api/replays/${replayId}/content`, {
    headers: { Range: "bytes=2-5" },
  });
  expect(partial?.status).toBe(206);
  expect(partial?.headers.get("Content-Range")).toBe("bytes 2-5/10");
  const partialBytes = await partial?.arrayBuffer();
  expect(partialBytes?.byteLength).toBe(4);
  const suffix = await request(`/api/replays/${replayId}/content`, {
    headers: { Range: "bytes=-3" },
  });
  expect(suffix?.headers.get("Content-Range")).toBe("bytes 7-9/10");
  const invalid = await request(`/api/replays/${replayId}/content`, {
    headers: { Range: "bytes=10-" },
  });
  expect(invalid?.status).toBe(416);
  expect(invalid?.headers.get("Content-Range")).toBe("bytes */10");
  openContent.mockClear();
  const cached = await request(`/api/replays/${replayId}/content`, {
    headers: { "If-None-Match": `W/"${replay.digest}"` },
  });
  expect(cached?.status).toBe(304);
  const head = await request(`/api/replays/${replayId}/content`, {
    method: "HEAD",
  });
  expect(head?.headers.get("Content-Length")).toBe("10");
  expect(await head?.text()).toBe("");
  expect(openContent).not.toHaveBeenCalled();
  const stale = await request(`/api/replays/${replayId}/content`, {
    headers: { Range: "bytes=2-5", "If-Range": '"stale"' },
  });
  expect(stale?.status).toBe(200);
});

test("range parser bounds and rejects multipart or unsafe numbers", () => {
  expect(parseReplayRange("bytes=0-999", 10)).toEqual({ start: 0, end: 9 });
  expect(parseReplayRange("bytes=0-1,3-4", 10)).toBeNull();
  expect(parseReplayRange("bytes=9007199254740992-", 10)).toBeNull();
  expect(parseReplayRange("bytes=-0", 10)).toBeNull();
  expect(parseReplayRange("bytes=-", 10)).toBeNull();
});

test("repository only selects completed artifacts and isolates the platform", async () => {
  mocks.findFirst.mockResolvedValue(null);
  await findPublicReplay(replayId);
  expect(mocks.findFirst.mock.calls[0]?.[0].where).toEqual({
    id: replayId,
    uploadState: "COMPLETED",
  });
  await findPublicMatchReplays("EUW1", "123");
  expect(mocks.findMany.mock.calls[0]?.[0].where).toEqual({
    platformId: "EUW1",
    gameId: "123",
    uploadState: "COMPLETED",
  });
});

test("S3 reads only the stored key and validates range length, digest and cancellation signal", async () => {
  const controller = new AbortController();
  mocks.send.mockResolvedValue({
    ContentLength: 4,
    ContentRange: "bytes 2-5/10",
    Metadata: { sha256: replay.digest },
    Body: {
      transformToWebStream: () => new Blob([new Uint8Array(4)]).stream(),
    },
  });
  const stream = await openReplayContent(
    replay,
    { start: 2, end: 5 },
    controller.signal,
  );
  expect(mocks.send.mock.calls[0]?.[0].input).toEqual({
    Bucket: "private",
    Key: replay.objectKey,
    Range: "bytes=2-5",
  });
  expect(mocks.send.mock.calls[0]?.[1]).toEqual({
    abortSignal: controller.signal,
  });
  const bytes = await new Response(stream).arrayBuffer();
  expect(bytes.byteLength).toBe(4);
  mocks.send.mockResolvedValue({
    ContentLength: 4,
    Metadata: { sha256: "wrong" },
    Body: {
      transformToWebStream: () => new Blob([new Uint8Array(4)]).stream(),
    },
  });
  await expect(
    openReplayContent(replay, { start: 2, end: 5 }, controller.signal),
  ).rejects.toThrow("metadata does not match");
});

test("response cancellation reaches object storage and truncated bytes fail loudly", async () => {
  const cancel = vi.fn();
  const controller = new AbortController();
  const stream = boundedReplayStream(
    new ReadableStream({ cancel }),
    10,
    controller.signal,
  );
  await stream.cancel("navigated away");
  expect(cancel).toHaveBeenCalledWith("navigated away");
  const truncated = boundedReplayStream(
    new Blob([new Uint8Array(9)]).stream(),
    10,
    new AbortController().signal,
  );
  await expect(new Response(truncated).arrayBuffer()).rejects.toThrow(
    "truncated",
  );
  const oversized = boundedReplayStream(
    new Blob([new Uint8Array(11)]).stream(),
    10,
    new AbortController().signal,
  );
  await expect(new Response(oversized).arrayBuffer()).rejects.toThrow(
    "exceeded",
  );
  const onAbort = vi.fn();
  const aborted = boundedReplayStream(
    new ReadableStream({ cancel: onAbort }),
    10,
    controller.signal,
  );
  controller.abort("request closed");
  await expect(new Response(aborted).arrayBuffer()).rejects.toBe(
    "request closed",
  );
  expect(onAbort).toHaveBeenCalledWith("request closed");
});

test("a full object read verifies actual body SHA-256, beyond matching object metadata", async () => {
  const bytes = new Uint8Array(10);
  const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  mocks.send.mockImplementation(async () => {
    await Promise.resolve();
    return {
      ContentLength: 10,
      Metadata: { sha256: digest },
      Body: { transformToWebStream: () => new Blob([bytes]).stream() },
    };
  });
  const original = await openReplayContent(
    { ...replay, digest },
    null,
    new AbortController().signal,
  );
  expect(await new Response(original).arrayBuffer()).toEqual(bytes.buffer);
  bytes[0] = 1;
  const corrupt = await openReplayContent(
    { ...replay, digest },
    null,
    new AbortController().signal,
  );
  await expect(new Response(corrupt).arrayBuffer()).rejects.toThrow("SHA-256");
});
