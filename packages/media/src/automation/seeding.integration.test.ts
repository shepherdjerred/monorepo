import { expect, test } from "vitest";
import { createSeedingActivities } from "./seeding.ts";
import { automationTestHarness } from "#testing/automation.ts";
import { CleanupEvaluationSchema } from "#shared/visibility/seeding.ts";
import {
  cleanupDigest,
  recordCleanupEvaluation,
} from "#infrastructure/visibility/seeding.ts";
import type { SeedingPolicy } from "#domain/seeding.ts";

const { database, context, fixture } = automationTestHarness();

async function seededTorrent() {
  const data = await fixture();
  const request = await database().mediaRequest.findFirstOrThrow({
    where: { mediaId: data.media.id },
  });
  const torrent = await database().torrent.create({
    data: {
      infoHash: data.source.infoHash,
      providerId: "knaben",
      owned: true,
      ownershipEpoch: 0,
      seedingPolicy: { kind: "public" },
      state: "seeding",
    },
  });
  const attempt = await database().acquisitionAttempt.create({
    data: {
      operationId: data.input.operationId,
      releaseId: data.release.id,
      sponsorRequestId: request.id,
      mediaIds: [data.media.id],
      generations: { [data.media.id]: 1 },
      state: "completed",
      torrentId: torrent.id,
    },
  });
  const isolated = `/downloads/media/${attempt.id}`;
  const observed = {
    hash: torrent.infoHash,
    infohash_v1: torrent.infoHash,
    infohash_v2: "",
    name: "Example.mkv",
    state: "uploading",
    category: "media",
    tags: `media-${data.input.operationId},media-attempt-${attempt.id}`,
    progress: 1,
    ratio: 2,
    ratio_limit: -1,
    seeding_time_limit: -1,
    inactive_seeding_time_limit: -1,
    max_ratio: -1,
    max_seeding_time: -1,
    max_inactive_seeding_time: -1,
    share_limit_action: "Stop",
    auto_tmm: false,
    force_start: false,
    seeding_time: 100,
    size: 1000,
    save_path: isolated,
    content_path: `${isolated}/Example.mkv`,
  };
  return { ...data, torrent, attempt, observed };
}

async function cleanupRecord(torrentId: string) {
  const row = await database().torrent.findUniqueOrThrow({
    where: { id: torrentId },
  });
  return {
    row,
    evaluation: CleanupEvaluationSchema.parse(row.cleanupEvaluation),
  };
}

function observedContext(
  observed: Awaited<ReturnType<typeof seededTorrent>>["observed"],
) {
  return context(async (url) => {
    if (url.pathname.endsWith("/auth/login"))
      return new Response(null, {
        status: 204,
        headers: { "set-cookie": "SID=fixture" },
      });
    if (url.pathname.endsWith("/torrents/info"))
      return Response.json([observed]);
    if (url.pathname.endsWith("/torrents/files")) return Response.json([]);
    throw new Error("Unexpected mutation");
  });
}

test("a disabled final cleanup gate releases a pre-effect claim and later retries safely", async () => {
  const data = await seededTorrent();
  let deletes = 0;
  let gateReads = 0;
  const ctx = context(async (url) => {
    if (url.pathname.endsWith("/auth/login"))
      return new Response("Ok.", { headers: { "set-cookie": "SID=fixture" } });
    if (url.pathname.endsWith("/torrents/info"))
      return Response.json([data.observed]);
    if (url.pathname.endsWith("/torrents/files")) return Response.json([]);
    if (url.pathname.endsWith("/torrents/delete")) {
      deletes++;
      return new Response();
    }
    throw new Error("Unexpected request");
  });
  ctx.gates.sourceCleanup = async () => {
    gateReads++;
    return gateReads !== 2;
  };
  const activities = createSeedingActivities(ctx);
  const input = {
    operationId: data.input.operationId,
    torrentId: data.torrent.id,
  };
  expect(await activities.removeMediaTorrent(input)).toMatchObject({
    status: "protected",
    reason: "source_dependencies_changed",
  });
  expect(
    await database().torrent.findUnique({ where: { id: data.torrent.id } }),
  ).toMatchObject({ state: "seeding" });
  expect(deletes).toBe(0);
  const protectedRecord = await cleanupRecord(data.torrent.id);
  expect(protectedRecord.evaluation).toMatchObject({
    phase: "removal",
    status: "protected",
    reason: "source_dependencies_changed",
  });
  expect(await activities.removeMediaTorrent(input)).toMatchObject({
    status: "removed",
  });
  expect(deletes).toBe(1);
  const removedRecord = await cleanupRecord(data.torrent.id);
  expect(removedRecord.evaluation).toMatchObject({
    phase: "removal",
    status: "removed",
    reason: null,
  });
});

test("a foreign torrent sharing the isolated source directory prevents file deletion", async () => {
  const data = await seededTorrent();
  const ctx = context(async (url) => {
    if (url.pathname.endsWith("/auth/login"))
      return new Response("Ok.", { headers: { "set-cookie": "SID=fixture" } });
    if (url.pathname.endsWith("/torrents/info"))
      return Response.json(
        url.searchParams.has("hashes")
          ? [data.observed]
          : [
              data.observed,
              {
                ...data.observed,
                hash: "a".repeat(40),
                infohash_v1: "a".repeat(40),
                category: "unmanaged",
                tags: "",
              },
            ],
      );
    if (url.pathname.endsWith("/torrents/files")) return Response.json([]);
    throw new Error("Unexpected mutation");
  });
  expect(
    await createSeedingActivities(ctx).removeMediaTorrent({
      operationId: data.input.operationId,
      torrentId: data.torrent.id,
    }),
  ).toMatchObject({ status: "protected", reason: "source_directory_shared" });
  expect(
    await database().torrent.findUnique({ where: { id: data.torrent.id } }),
  ).toMatchObject({ state: "seeding" });
  const record = await cleanupRecord(data.torrent.id);
  expect(record.evaluation).toMatchObject({
    phase: "removal",
    status: "protected",
    reason: "source_directory_shared",
  });
});

test("a late native-limit writer prevents removal and releases the pre-effect claim", async () => {
  const data = await seededTorrent();
  let reads = 0;
  let deletes = 0;
  const ctx = context(async (url) => {
    if (url.pathname.endsWith("/auth/login"))
      return new Response(null, {
        status: 204,
        headers: { "set-cookie": "SID=fixture" },
      });
    if (url.pathname.endsWith("/torrents/info")) {
      reads++;
      return Response.json([
        {
          ...data.observed,
          ...(reads > 1
            ? { seeding_time_limit: 123, max_seeding_time: 123 }
            : {}),
        },
      ]);
    }
    if (url.pathname.endsWith("/torrents/files")) return Response.json([]);
    if (url.pathname.endsWith("/torrents/delete")) deletes++;
    throw new Error("Unexpected mutation");
  });
  expect(
    await createSeedingActivities(ctx).removeMediaTorrent({
      operationId: data.input.operationId,
      torrentId: data.torrent.id,
    }),
  ).toEqual({ status: "protected", reason: "torrent_policy_drift" });
  expect(deletes).toBe(0);
  expect(
    await database().torrent.findUniqueOrThrow({
      where: { id: data.torrent.id },
    }),
  ).toMatchObject({ state: "seeding" });
  const record = await cleanupRecord(data.torrent.id);
  expect(record.evaluation).toMatchObject({
    phase: "removal",
    status: "protected",
    reason: "torrent_policy_drift",
  });
});

const policies: {
  policy: SeedingPolicy;
  reason: string;
  status: string;
  ratio?: number;
}[] = [
  {
    policy: { kind: "unknown" },
    reason: "policy_required",
    status: "protected",
  },
  {
    policy: { kind: "privatehd", verified: false, ratio: null },
    reason: "policy_unverified",
    status: "protected",
  },
  {
    policy: { kind: "privatehd", verified: true, ratio: null },
    reason: "seeding_required",
    status: "seeding",
  },
  {
    policy: { kind: "public" },
    reason: "obligations_satisfied",
    status: "removable",
  },
  {
    policy: { kind: "public" },
    ratio: -1,
    reason: "obligations_satisfied",
    status: "removable",
  },
  {
    policy: {
      kind: "private",
      verified: true,
      ratio: 1,
      minimumSeconds: 60,
      combination: "all",
      sizeRule: null,
    },
    reason: "obligations_satisfied",
    status: "removable",
  },
];

test.each(policies)(
  "records actual $policy.kind obligation outcome $reason without deleting",
  async ({ policy, reason, status, ratio }) => {
    const data = await seededTorrent();
    await database().torrent.update({
      where: { id: data.torrent.id },
      data: { seedingPolicy: policy },
    });
    const result = await createSeedingActivities(
      observedContext({
        ...data.observed,
        ratio: ratio ?? data.observed.ratio,
      }),
    ).evaluateMediaSeeding({
      torrentId: data.torrent.id,
      operationId: data.input.operationId,
    });
    expect(result).toEqual({ status, reason });
    const { row, evaluation } = await cleanupRecord(data.torrent.id);
    expect(evaluation).toMatchObject({
      phase: "evaluation",
      status,
      reason,
      recoveryEpoch: 0,
      ownershipEpoch: 0,
      observedAt: row.observedAt?.toISOString(),
      policyDigest: cleanupDigest(policy),
      observationDigest: cleanupDigest(row.observation),
    });
    expect(row.state).toBe("seeding");
  },
);

test.each(["gate", "epoch"])(
  "records early %s protection without refreshing raw evidence or contacting qBit",
  async (kind) => {
    const data = await seededTorrent();
    const observedAt = new Date("2026-01-01T00:00:00Z");
    await database().torrent.update({
      where: { id: data.torrent.id },
      data: {
        observation: { prior: true },
        observedAt,
        ...(kind === "epoch" ? { ownershipEpoch: -1 } : {}),
      },
    });
    const ctx = context(async () => {
      throw new Error("No network expected");
    });
    if (kind === "gate") ctx.gates.sourceCleanup = async () => false;
    expect(
      await createSeedingActivities(ctx).evaluateMediaSeeding({
        torrentId: data.torrent.id,
        operationId: data.input.operationId,
      }),
    ).toEqual({ status: "protected", reason: "source_cleanup_disabled" });
    const { row, evaluation } = await cleanupRecord(data.torrent.id);
    expect(row.observation).toEqual({ prior: true });
    expect(row.observedAt).toEqual(observedAt);
    expect(evaluation).toMatchObject({
      reason: "source_cleanup_disabled",
      observedAt: observedAt.toISOString(),
      recoveryEpoch: 0,
      ownershipEpoch: kind === "epoch" ? -1 : 0,
    });
  },
);

test("missing torrents retain the old observation timestamp in their protected diagnostic", async () => {
  const data = await seededTorrent();
  const ctx = context(async (url) => {
    if (url.pathname.endsWith("/auth/login"))
      return new Response("Ok.", { headers: { "set-cookie": "SID=fixture" } });
    if (url.pathname.endsWith("/torrents/info")) return Response.json([]);
    throw new Error("Unexpected request");
  });
  expect(
    await createSeedingActivities(ctx).evaluateMediaSeeding({
      torrentId: data.torrent.id,
      operationId: data.input.operationId,
    }),
  ).toEqual({ status: "protected", reason: "torrent_missing" });
  const record = await cleanupRecord(data.torrent.id);
  expect(record.evaluation).toMatchObject({
    observedAt: null,
    reason: "torrent_missing",
  });
});

test.each(["download", "dependency", "drift"])(
  "records controlled %s protection from the actual observation",
  async (kind) => {
    const data = await seededTorrent();
    if (kind === "dependency")
      await database().acquisitionAttempt.update({
        where: { id: data.attempt.id },
        data: { state: "imported" },
      });
    const observed = {
      ...data.observed,
      ...(kind === "download" ? { progress: 0.5 } : {}),
      ...(kind === "drift" ? { max_ratio: 3, ratio_limit: 3 } : {}),
    };
    const reason =
      kind === "download"
        ? "download_incomplete"
        : kind === "dependency"
          ? "source_in_use"
          : "torrent_policy_drift";
    expect(
      await createSeedingActivities(
        observedContext(observed),
      ).evaluateMediaSeeding({
        torrentId: data.torrent.id,
        operationId: data.input.operationId,
      }),
    ).toEqual({ status: "protected", reason });
    const record = await cleanupRecord(data.torrent.id);
    expect(record.evaluation).toMatchObject({
      reason,
      status: "protected",
    });
  },
);

test("lost delete acknowledgement records uncertainty and retains the unresolved removal claim", async () => {
  const data = await seededTorrent();
  let deletes = 0;
  const ctx = context(async (url) => {
    if (url.pathname.endsWith("/auth/login"))
      return new Response("Ok.", { headers: { "set-cookie": "SID=fixture" } });
    if (url.pathname.endsWith("/torrents/info"))
      return Response.json([data.observed]);
    if (url.pathname.endsWith("/torrents/files")) return Response.json([]);
    if (url.pathname.endsWith("/torrents/delete")) {
      deletes++;
      throw new Error("Injected lost acknowledgement");
    }
    throw new Error("Unexpected request");
  });
  const activities = createSeedingActivities(ctx);
  const input = {
    torrentId: data.torrent.id,
    operationId: data.input.operationId,
  };
  await expect(activities.removeMediaTorrent(input)).rejects.toMatchObject({
    kind: "outcome-unknown",
  });
  const { row, evaluation } = await cleanupRecord(data.torrent.id);
  expect(row.state).toBe("removing");
  expect(evaluation).toMatchObject({
    phase: "removal",
    status: "protected",
    reason: "removal_outcome_unknown",
    observedAt: row.observedAt?.toISOString(),
  });
  expect(await activities.removeMediaTorrent(input)).toEqual({
    status: "protected",
    reason: "removal_outcome_unknown",
  });
  expect(deletes).toBe(1);
});

test("an informational removed record cannot authorize cleanup past the real gate", async () => {
  const data = await seededTorrent();
  expect(
    await recordCleanupEvaluation(database(), data.torrent, {
      evaluatedAt: new Date(),
      recoveryEpoch: 0,
      phase: "removal",
      status: "removed",
      reason: null,
    }),
  ).toBe(true);
  const ctx = context(async () => {
    throw new Error("No network expected");
  });
  ctx.gates.sourceCleanup = async () => false;
  expect(
    await createSeedingActivities(ctx).removeMediaTorrent({
      torrentId: data.torrent.id,
      operationId: data.input.operationId,
    }),
  ).toEqual({ status: "protected", reason: "source_cleanup_disabled" });
  const record = await cleanupRecord(data.torrent.id);
  expect(record.row.state).toBe("seeding");
});

test("a delayed observation cannot bind its old policy outcome to a concurrently changed policy", async () => {
  const data = await seededTorrent();
  const waiting = Promise.withResolvers<undefined>();
  const resume = Promise.withResolvers<undefined>();
  const ctx = context(async (url) => {
    if (url.pathname.endsWith("/auth/login"))
      return new Response("Ok.", { headers: { "set-cookie": "SID=fixture" } });
    if (url.pathname.endsWith("/torrents/info")) {
      waiting.resolve(undefined);
      await resume.promise;
      return Response.json([data.observed]);
    }
    if (url.pathname.endsWith("/torrents/files")) return Response.json([]);
    throw new Error("Unexpected mutation");
  });
  const input = {
    torrentId: data.torrent.id,
    operationId: data.input.operationId,
  };
  const pending = createSeedingActivities(ctx).evaluateMediaSeeding(input);
  await waiting.promise;
  try {
    await database().torrent.update({
      where: { id: data.torrent.id },
      data: { seedingPolicy: { kind: "unknown" } },
    });
    const blocked = context(async () => {
      throw new Error("No network expected");
    });
    blocked.gates.sourceCleanup = async () => false;
    await createSeedingActivities(blocked).evaluateMediaSeeding(input);
  } finally {
    resume.resolve(undefined);
  }
  expect(await pending).toEqual({
    status: "removable",
    reason: "obligations_satisfied",
  });
  const { row, evaluation } = await cleanupRecord(data.torrent.id);
  expect(row.seedingPolicy).toEqual({ kind: "unknown" });
  expect(evaluation).toMatchObject({
    reason: "source_cleanup_disabled",
    policyDigest: cleanupDigest({ kind: "unknown" }),
    observedAt: null,
  });
  expect(evaluation.observationDigest).not.toBe(cleanupDigest(row.observation));
  expect(row.state).toBe("seeding");
});
