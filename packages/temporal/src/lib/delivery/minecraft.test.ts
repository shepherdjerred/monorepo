import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  PipelineRevisionSchema,
  VersionSetRevisionSchema,
} from "@shepherdjerred/delivery/contract";
import {
  minecraftImageParameters,
  minecraftRuntimeImage,
  validateMinecraftPreservation,
} from "./minecraft.ts";

const timestamp = "2026-10-17T20:00:00.000Z";
const now = Date.parse(timestamp);
const requestId = "6903b19f-f4d2-42a5-91ba-6ce046562c83";
const uri = "docker.io/shepherdjerred/the-storm-server";
function version(digit: string) {
  return VersionSetRevisionSchema.parse({
    id: `set/${digit}`,
    serviceId: "minecraft",
    revision: 1,
    baseRevisionId: null,
    createdAt: timestamp,
    components: {
      "image:the-storm-server": {
        id: `image/${digit}`,
        serviceId: "minecraft",
        buildId: `build/${digit}`,
        sourceRevision: digit.repeat(40),
        component: "image:the-storm-server",
        kind: "image",
        uri,
        digest: `sha256:${digit.repeat(64)}`,
        runtimeDigests: [`sha256:${"c".repeat(64)}`],
        version: "build-123",
        createdAt: timestamp,
      },
    },
  });
}
async function fixture() {
  const definition: unknown = await Bun.file(
    new URL(
      "../../../../delivery/registrations/specialized/minecraft-tsmc/pipeline.json",
      import.meta.url,
    ),
  ).json();
  return {
    pipeline: PipelineRevisionSchema.parse({
      id: "minecraft-tsmc/1",
      createdAt: timestamp,
      definition,
    }),
    environment: { application: "minecraft-tsmc" },
    deployment: {
      id: "deployment/tsmc",
      kind: "deploy" as const,
      serviceId: "minecraft",
      environmentId: "minecraft/tsmc",
    },
    versionSet: version("b"),
    previousAcceptedVersionSet: version("a"),
  };
}
function receipt() {
  return {
    schemaVersion: 1,
    kind: "storm-independent-restore",
    status: "VERIFIED",
    requestId,
    completedAt: timestamp,
    candidateImage: `${uri}:build-123@sha256:${"b".repeat(64)}`,
    sourceImage: `${uri}:accepted@sha256:${"a".repeat(64)}`,
    serverUid: "production-server-uid",
    source: {
      claimUid: "original-claim",
      volumeUid: "original-volume",
      volumeSource: { driver: "zfs", volumeHandle: "original-handle" },
    },
    restored: {
      namespace: "minecraft-tsmc-delivery-validation",
      claimUid: "restored-claim",
      volumeUid: "restored-volume",
      volumeSource: { driver: "zfs", volumeHandle: "restored-handle" },
    },
    backupUid: "backup-uid",
    restoreUid: "restore-uid",
    wholeVolumeProofSha256: "d".repeat(64),
    originalUntouchedProofSha256: "e".repeat(64),
    files: 1234,
    candidate: {
      podUid: "candidate-uid",
      imageId: `docker-pullable://${uri}@sha256:${"c".repeat(64)}`,
      containerId: "containerd://candidate-incarnation",
      restartCount: 0,
      gracefulStop: true,
      safeModules: ["economy", "mail", "chat", "tracks", "towns", "tickets"],
      gameplaySha256: "f".repeat(64),
      startupLogSha256: "0".repeat(64),
    },
    originalUntouched: true,
    originalReopened: true,
    scope:
      "restored-copy-startup-and-citizens-gameplay; production acceptance is separate",
  };
}
function result(value: unknown = receipt()) {
  const receiptJson = JSON.stringify(value);
  return {
    requestId,
    receiptJson,
    receiptSha256: `sha256:${createHash("sha256").update(receiptJson).digest("hex")}`,
  };
}

describe("TSMC routine upgrade preservation boundary", () => {
  test("projects the real upstream repository/tag pair to one exact immutable image", async () => {
    const detail = await fixture();
    expect(minecraftImageParameters(detail)).toEqual({
      "image.repository": uri,
      "image.tag": `build-123@sha256:${"b".repeat(64)}`,
    });
    expect(minecraftRuntimeImage(detail)).toBe(
      `${uri}:build-123@sha256:${"b".repeat(64)}`,
    );
    expect(
      validateMinecraftPreservation(detail, requestId, result(), now),
    ).toMatchObject([
      { kind: "backup", operationId: requestId },
      { kind: "preflight", operationId: requestId },
    ]);
  });
  test("rejects changed receipt bytes, another request, stale proof and unrelated runtime digest", async () => {
    const detail = await fixture();
    expect(() =>
      validateMinecraftPreservation(
        detail,
        requestId,
        { ...result(), receiptJson: "{}" },
        now,
      ),
    ).toThrow("bytes or request identity");
    expect(() =>
      validateMinecraftPreservation(detail, "different-request", result(), now),
    ).toThrow("request identity");
    expect(() =>
      validateMinecraftPreservation(
        detail,
        requestId,
        result(),
        now + 31 * 60_000,
      ),
    ).toThrow("fresh exact candidate");
    const wrongRuntime = receipt();
    wrongRuntime.candidate.imageId = `containerd://sha256:${"9".repeat(64)}`;
    expect(() =>
      validateMinecraftPreservation(
        detail,
        requestId,
        result(wrongRuntime),
        now,
      ),
    ).toThrow("fresh exact candidate");
  });
  test("neutral schema rejects caller-shaped summaries and incomplete candidate acceptance", async () => {
    const detail = await fixture();
    for (const patch of [
      { status: "VERIFIED", summary: "backup completed" },
      { ...receipt(), originalUntouched: false },
      {
        ...receipt(),
        candidate: { ...receipt().candidate, gracefulStop: false },
      },
      {
        ...receipt(),
        candidate: { ...receipt().candidate, safeModules: ["discord"] },
      },
    ])
      expect(() =>
        validateMinecraftPreservation(detail, requestId, result(patch), now),
      ).toThrow();
  });
  test("accepts the producer's timezone-bearing ISO timestamp without changing its receipt bytes", async () => {
    const detail = await fixture();
    const pythonTimestamp = receipt();
    pythonTimestamp.completedAt = "2026-10-17T20:00:00+00:00";
    expect(
      validateMinecraftPreservation(
        detail,
        requestId,
        result(pythonTimestamp),
        now,
      ),
    ).toHaveLength(2);
  });
  test("rejects storage aliases and source images different from the frozen accepted release", async () => {
    const detail = await fixture();
    const aliased = receipt();
    aliased.restored.volumeSource.volumeHandle =
      aliased.source.volumeSource.volumeHandle;
    expect(() =>
      validateMinecraftPreservation(detail, requestId, result(aliased), now),
    ).toThrow("aliases production");
    const foreignSource = receipt();
    foreignSource.sourceImage = `${uri}:other@sha256:${"9".repeat(64)}`;
    expect(() =>
      validateMinecraftPreservation(
        detail,
        requestId,
        result(foreignSource),
        now,
      ),
    ).toThrow("frozen accepted");
  });
  test("refuses routine image rollback and other application identities", async () => {
    const detail = await fixture();
    expect(() =>
      minecraftImageParameters({
        ...detail,
        deployment: { ...detail.deployment, kind: "rollback" },
      }),
    ).toThrow("independent restoration procedure");
    expect(() =>
      minecraftRuntimeImage({
        ...detail,
        environment: { application: "minecraft-shuxin" },
      }),
    ).toThrow("reviewed TSMC target");
  });
});
