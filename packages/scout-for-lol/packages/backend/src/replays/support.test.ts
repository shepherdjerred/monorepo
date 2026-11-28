import { beforeEach, expect, test, vi } from "vitest";
import type { PublicReplayIdentity } from "./catalog.ts";
import {
  ReplayRenderPackageManifestSchema,
  type ReplayPatchObservation,
} from "@scout-for-lol/domain/artifacts/replay-support.ts";
import { admittedReplayRenderPackageFixture } from "./testing/render-package-fixture.ts";

const database = vi.hoisted(() => ({
  observation: vi.fn(),
  renderPackage: vi.fn(),
}));
vi.mock("#src/database/index.ts", () => ({
  prisma: {
    replayPatchObservation: { findUnique: database.observation },
    replayRenderPackage: { findUnique: database.renderPackage },
  },
}));
const {
  resolveReplaySupport,
  verifyReplayRenderPackage,
  REPLAY_PATCH_OBSERVATION_MAX_AGE_MS,
} = await import("./support.ts");

const now = new Date("2026-11-13T20:00:00Z");
const replay: PublicReplayIdentity = {
  replayId: "58001d3b-f679-4bb6-9b3d-314900818b27",
  matchId: "NA1_123",
  platformId: "NA1",
  gameId: "123",
  bytes: 10,
  sha256: "a".repeat(64),
  gameBuild: "16.22.830.1",
  protocol: "b".repeat(16),
  durationSeconds: 60,
  mapId: 11,
  gameMode: "CLASSIC",
  teamSizes: [5, 5],
};
const observation: ReplayPatchObservation = {
  platformId: "NA1",
  patch: "16.22",
  gameBuild: "16.22.830.1",
  sourceUrl:
    "https://sieve.services.riotcdn.net/api/v1/products/lol/version-sets/NA1/versions?platform=windows",
  sourceSha256: "c".repeat(64),
  observedAt: "2026-11-13T19:55:00Z",
};
const readObservation = vi.fn();
const renderPackage = vi.fn();
const deps = { observation: readObservation, renderPackage, now: () => now };

function admittedPackage() {
  return admittedReplayRenderPackageFixture({
    gameBuild: "16.22.830.1",
    protocol: "b".repeat(16),
    publishedAt: new Date("2026-11-13T19:00:00Z"),
    admittedAt: new Date("2026-11-13T19:30:00Z"),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  readObservation.mockResolvedValue(observation);
  renderPackage.mockResolvedValue(null);
});

test("unqualified or incomplete input cannot become playable", async () => {
  expect(
    await resolveReplaySupport({ ...replay, platformId: null }, deps),
  ).toMatchObject({ status: "incompatible", reason: "unqualified_platform" });
  expect(
    await resolveReplaySupport({ ...replay, protocol: null }, deps),
  ).toEqual({ status: "metadata_pending" });
  expect(await resolveReplaySupport({ ...replay, mapId: null }, deps)).toEqual({
    status: "metadata_pending",
  });
  expect(renderPackage).not.toHaveBeenCalled();
});

test("missing and stale upstream observations cannot retain a historical active patch", async () => {
  readObservation.mockResolvedValue(null);
  expect(await resolveReplaySupport(replay, deps)).toEqual({
    status: "support_preparing",
    latestPatch: null,
    reason: "patch_unobserved",
  });
  readObservation.mockResolvedValue({
    ...observation,
    observedAt: new Date(
      now.getTime() - REPLAY_PATCH_OBSERVATION_MAX_AGE_MS,
    ).toISOString(),
  });
  expect(await resolveReplaySupport(replay, deps)).toMatchObject({
    status: "support_preparing",
    reason: "patch_unobserved",
    latestPatch: null,
  });
  expect(renderPackage).not.toHaveBeenCalled();
});

test("older patch, unadmitted current patch, and different hotfix build are distinct", async () => {
  expect(
    await resolveReplaySupport({ ...replay, gameBuild: "16.9.1.1" }, deps),
  ).toMatchObject({
    status: "incompatible",
    reason: "older_patch",
    latestPatch: "16.22",
  });
  expect(
    await resolveReplaySupport({ ...replay, gameBuild: "16.22.830.2" }, deps),
  ).toMatchObject({ status: "incompatible", reason: "unsupported_build" });
  expect(await resolveReplaySupport(replay, deps)).toEqual({
    status: "support_preparing",
    latestPatch: "16.22",
    reason: "render_package_unavailable",
  });
  expect(renderPackage).toHaveBeenCalledWith(replay.gameBuild, replay.protocol);
});

test.each([
  [{ mapId: 12 }, "unsupported_map"],
  [{ gameMode: "ARAM" }, "unsupported_mode"],
  [{ teamSizes: [3, 3] }, "unsupported_roster"],
  [{ teamSizes: [5, 5, 5] }, "unsupported_roster"],
] as const)(
  "verified presentation boundaries reject %j",
  async (change, reason) => {
    expect(
      await resolveReplaySupport(
        {
          ...replay,
          ...change,
          teamSizes:
            "teamSizes" in change ? [...change.teamSizes] : replay.teamSizes,
        },
        deps,
      ),
    ).toMatchObject({ status: "incompatible", reason });
    expect(renderPackage).not.toHaveBeenCalled();
  },
);

test("platform-specific observations respect staggered regional patch rollout", async () => {
  readObservation.mockImplementation(async (platformId: string) => {
    await Promise.resolve();
    return platformId === "EUW1"
      ? {
          ...observation,
          platformId,
          patch: "16.21",
          gameBuild: "16.21.829.8620",
          sourceUrl: observation.sourceUrl.replace("NA1", "EUW1"),
        }
      : observation;
  });
  const oldReplay = { ...replay, gameBuild: "16.21.829.8620" };
  expect(await resolveReplaySupport(oldReplay, deps)).toMatchObject({
    reason: "older_patch",
  });
  expect(
    await resolveReplaySupport({ ...oldReplay, platformId: "EUW1" }, deps),
  ).toMatchObject({
    status: "support_preparing",
    latestPatch: "16.21",
    reason: "render_package_unavailable",
  });
});

test("availability requires exact publication digest and bound native comparison evidence", async () => {
  const row = admittedPackage();
  renderPackage.mockResolvedValue(row);
  expect(await resolveReplaySupport(replay, deps)).toEqual({
    status: "available",
    latestPatch: "16.22",
    package: { url: row.manifestPath, sha256: row.manifestSha256 },
  });
  await expect(
    resolveReplaySupport({ ...replay, protocol: "0".repeat(16) }, deps),
  ).rejects.toThrow("immutable manifest");
});

test("corrupt manifests, receipt digests, paths and native evidence fail loudly", () => {
  const row = admittedPackage();
  for (const invalid of [
    { ...row, manifestJson: `${row.manifestJson} ` },
    { ...row, publishedSha256: "0".repeat(64) },
    { ...row, manifestPath: "https://other.test/manifest.json" },
    { ...row, admittedAt: new Date(now.getTime() + 1) },
    {
      ...row,
      admissionJson: {
        ...row.admissionJson,
        rosterInventorySha256: "0".repeat(64),
      },
    },
    {
      ...row,
      admissionJson: {
        ...row.admissionJson,
        nativeComparison: {
          ...row.admissionJson.nativeComparison,
          gameBuild: "16.21.1.1",
        },
      },
    },
  ])
    expect(() =>
      verifyReplayRenderPackage(
        invalid,
        "16.22.830.1",
        replay.protocol ?? "",
        now,
      ),
    ).toThrow();
  const duplicate = ReplayRenderPackageManifestSchema.parse(
    JSON.parse(row.manifestJson),
  );
  duplicate.files.push(...duplicate.files);
  expect(() =>
    verifyReplayRenderPackage(
      { ...row, manifestJson: JSON.stringify(duplicate) },
      "16.22.830.1",
      replay.protocol ?? "",
      now,
    ),
  ).toThrow("inventory");
  const encoded = ReplayRenderPackageManifestSchema.parse(
    JSON.parse(row.manifestJson),
  );
  encoded.files[0] = {
    path: "%2e%2e/outside.js",
    sha256: "a".repeat(64),
    bytes: 1,
  };
  expect(() =>
    verifyReplayRenderPackage(
      { ...row, manifestJson: JSON.stringify(encoded) },
      "16.22.830.1",
      replay.protocol ?? "",
      now,
    ),
  ).toThrow("relative package path");
});

test("package inventory reserves only the root manifest key", () => {
  const manifest = ReplayRenderPackageManifestSchema.parse(
    JSON.parse(admittedPackage().manifestJson),
  );
  const nested = {
    path: "nested/manifest.json",
    sha256: "a".repeat(64),
    bytes: 1,
  };
  expect(
    ReplayRenderPackageManifestSchema.safeParse({
      ...manifest,
      files: [...manifest.files, nested],
    }).success,
  ).toBe(true);
  expect(() =>
    ReplayRenderPackageManifestSchema.parse({
      ...manifest,
      files: [...manifest.files, { ...nested, path: "manifest.json" }],
    }),
  ).toThrow("The root manifest.json is reserved for the package manifest");
});

test.each([
  { ...observation, platformId: "EUW1" },
  { ...observation, patch: "16.21" },
  { ...observation, gameBuild: "16.22.830.0001" },
  { ...observation, observedAt: "2026-11-13T21:00:00Z" },
  { ...observation, sourceSha256: "invalid" },
  { ...observation, sourceUrl: "https://other.test/releases" },
])(
  "corrupt current release registry is not disguised as missing support",
  async (invalid) => {
    readObservation.mockResolvedValue(invalid);
    await expect(resolveReplaySupport(replay, deps)).rejects.toThrow();
  },
);

test("default reads use the requested platform and exact build/protocol index", async () => {
  database.observation.mockResolvedValue({
    ...observation,
    observedAt: new Date(),
  });
  database.renderPackage.mockResolvedValue(null);
  await resolveReplaySupport(replay);
  expect(database.observation).toHaveBeenCalledWith({
    where: { platformId: "NA1" },
  });
  expect(database.renderPackage).toHaveBeenCalledWith({
    where: {
      gameBuild_protocol: {
        gameBuild: replay.gameBuild,
        protocol: replay.protocol,
      },
    },
  });
});
