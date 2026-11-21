import { expect, test } from "vitest";
import { createSubtitleActivities } from "#automation/subtitles.ts";
import { fromOpenSubtitles, fromAssrt } from "#automation/subtitle-sources.ts";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { regularDialogueCovered } from "#domain/subtitle-speech.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { MediaRequestCommands } from "#infrastructure/request-commands.ts";
import { createSweepActivities } from "#automation/sweeps.ts";
import type { SubtitlePolicyTargetSchema } from "#shared/subtitle-policy.ts";
import { targetHarness, subtitleTransport } from "./target-fixture.ts";
import {
  currentSubtitleWork,
  SubtitleWorkSchema,
  subtitleTargetsReady,
} from "./authority.ts";

const harness = targetHarness();

function recordPolicyTargets(
  f: Awaited<ReturnType<typeof harness.setup>>,
  targets: z.infer<typeof SubtitlePolicyTargetSchema>[],
) {
  return f.db.mediaSubtitlePolicyVersion.create({
    data: {
      mediaId: f.media.id,
      actorId: f.user.id,
      version: 1,
      recoveryEpoch: 0,
      source: { fixture: true },
      rules: { schemaVersion: 1, protectedReasons: [], targets },
    },
  });
}

test("an ordinary language-only request queues ASSRT and installs proven Simplified Chinese without inventing forced or HI flags", async () => {
  const f = await harness.setup();
  await recordPolicyTargets(f, []);
  await f.db.mediaRequest.update({
    where: { id: f.request.id },
    data: { subtitleLanguages: ["zh-Hans"] },
  });
  const { transport, calls } = await harness.assrt(f.db, "mixed");
  expect(await f.queue()).toBe(1);
  const operation = await f.db.operation.findFirstOrThrow({
    where: { kind: "acquire_subtitles", targetId: f.asset.id },
  });
  const parsed = SubtitleWorkSchema.extend({
    operationId: z.string(),
    assetId: z.string(),
  }).parse(operation.payload);
  expect(parsed.forced).toBeUndefined();
  expect(operation.idempotencyKey).toContain(":zh-Hans:any:any:");
  const input = {
    operationId: parsed.operationId,
    assetId: parsed.assetId,
    language: parsed.language,
    ...(parsed.targetAuthority === undefined
      ? {}
      : { targetAuthority: parsed.targetAuthority }),
  };
  const found = await createSubtitleActivities(f.network, {
    assrt: (context, search) => fromAssrt(context, search, transport),
  }).findMediaSubtitles(input);
  expect(found.status).toBe("found");
  expect(
    await createMediaFileActivities(f.context).installMediaSubtitles({
      operationId: input.operationId,
      subtitleId: found.subtitleId ?? "missing",
    }),
  ).toEqual({ status: "installed" });
  const installed = await f.db.subtitleAsset.findUniqueOrThrow({
    where: { id: found.subtitleId ?? "missing" },
  });
  expect(installed).toMatchObject({
    state: "installed",
    qualityStatus: "accepted",
    forced: null,
    hearingImpaired: null,
  });
  const installedPath = workerFilePath(
    f.context,
    z.string().parse(installed.path),
  );
  const installedBytes = await readFile(installedPath);
  expect(
    subtitleTargetsReady(await currentSubtitleWork(f.db, f.asset.id, 0), 0),
  ).toBe(true);
  expect(calls).toEqual([
    "/v1/user/quota",
    "/v1/sub/search",
    "/v1/sub/detail",
    "/v1/sub/detail",
    "/v1/sub/detail",
    "/fixture",
  ]);
  await f.db.mediaSubtitlePolicyVersion.create({
    data: {
      mediaId: f.media.id,
      actorId: f.user.id,
      version: 2,
      recoveryEpoch: 0,
      source: { fixture: true },
      rules: {
        schemaVersion: 1,
        protectedReasons: [],
        targets: [
          {
            sourceItemId: 1,
            language: "zh-Hans",
            audioLanguage: "zh",
            forced: false,
            hearingImpaired: "any",
            audio: "any",
          },
        ],
      },
    },
  });
  expect(await f.queue()).toBe(1);
  const work = await currentSubtitleWork(f.db, f.asset.id, 0);
  expect(subtitleTargetsReady(work, 0)).toBe(false);
  const exact = await f.db.operation.findFirstOrThrow({
    where: {
      kind: "acquire_subtitles",
      targetId: f.asset.id,
      id: { not: operation.id },
    },
  });
  expect(exact.idempotencyKey).toContain(":zh-Hans:regular:any:");
  await f.db.providerLease.updateMany({
    where: { providerId: "assrt" },
    data: { nextAllowedAt: new Date(0) },
  });
  const count = calls.length;
  const regular = await createSubtitleActivities(f.network, {
    assrt: (context, search) => fromAssrt(context, search, transport),
  }).findMediaSubtitles({
    operationId: exact.id,
    assetId: f.asset.id,
    language: "zh-Hans",
    forced: false,
    hearingImpaired: "any",
    targetAuthority: work.authority,
  });
  expect(regular.status).toBe("found");
  expect(regular.subtitleId).not.toBe(installed.id);
  expect(calls.length).toBeGreaterThan(count);
  expect(calls.slice(count)).toContain("/fixture");
  expect(
    await f.db.subtitleAsset.findUniqueOrThrow({
      where: { id: regular.subtitleId ?? "missing" },
    }),
  ).toMatchObject({
    state: "validated",
    forced: null,
    hearingImpaired: null,
    matchingEvidence: {
      targetAuthority: work.authority,
      regularDialogueRequiredV1: true,
    },
  });
  expect(
    subtitleTargetsReady(await currentSubtitleWork(f.db, f.asset.id, 0), 0),
  ).toBe(false);
  expect(
    await f.db.subtitleAsset.findUniqueOrThrow({ where: { id: installed.id } }),
  ).toEqual(installed);
  expect(await readFile(installedPath)).toEqual(installedBytes);
});

test("regular Simplified Chinese becomes ready only after real speech proof and Files installation", async () => {
  const f = await harness.setup({ speechVideo: true });
  const videoBytes = await readFile(workerFilePath(f.context, f.asset.path));
  expect(videoBytes).toEqual(
    Buffer.from(z.instanceof(Uint8Array).parse(f.videoBytes)),
  );
  expect(createHash("sha256").update(videoBytes).digest("hex")).toBe(
    f.asset.checksum,
  );
  await recordPolicyTargets(f, [
    {
      sourceItemId: 1,
      language: "zh-Hans",
      audioLanguage: "zh",
      forced: false,
      hearingImpaired: "any",
      audio: "any",
    },
  ]);
  const provider = await harness.assrt(f.db);
  expect(await f.queue()).toBe(1);
  const [input] = await f.inputs();
  if (input === undefined) throw new Error("No regular Chinese target");
  const work = await currentSubtitleWork(f.db, f.asset.id, 0);
  const found = await createSubtitleActivities(f.network, {
    assrt: (context, search) => fromAssrt(context, search, provider.transport),
  }).findMediaSubtitles(input);
  expect(found.status).toBe("found");
  const subtitleId = z.uuid().parse(found.subtitleId);
  const before = await f.db.subtitleAsset.findUniqueOrThrow({
    where: { id: subtitleId },
  });
  expect(before).toMatchObject({
    state: "validated",
    forced: null,
    hearingImpaired: null,
    matchingEvidence: {
      targetAuthority: work.authority,
      regularDialogueRequiredV1: true,
    },
  });
  expect(
    subtitleTargetsReady(await currentSubtitleWork(f.db, f.asset.id, 0), 0),
  ).toBe(false);
  const files = createMediaFileActivities(f.context);
  await files.prepareSubtitleSpeechV1({
    subtitleId,
    operationId: input.operationId,
  });
  const measured = await f.db.subtitleAsset.findUniqueOrThrow({
    where: { id: subtitleId },
  });
  const evidence = z
    .record(z.string(), z.json())
    .parse(measured.matchingEvidence);
  expect(
    regularDialogueCovered(
      evidence["regularDialogueV1"],
      f.asset.checksum,
      measured.checksum,
    ),
  ).toBe(true);
  expect(evidence["timingAlignedV1"]).toMatchObject({
    videoChecksum: f.asset.checksum,
    subtitleChecksum: measured.checksum,
    engine: "ffsubsync-0.5.1",
    goldenSectionRequested: true,
    fixFrameRate: false,
  });
  expect(measured).toMatchObject({
    state: "validated",
    qualityStatus: "accepted",
    forced: null,
    hearingImpaired: null,
  });
  expect(
    subtitleTargetsReady(await currentSubtitleWork(f.db, f.asset.id, 0), 0),
  ).toBe(false);
  expect(
    await files.installMediaSubtitles({
      subtitleId,
      operationId: input.operationId,
    }),
  ).toEqual({ status: "installed" });
  const installed = await f.db.subtitleAsset.findUniqueOrThrow({
    where: { id: subtitleId },
  });
  expect(installed).toMatchObject({
    state: "installed",
    forced: null,
    hearingImpaired: null,
    checksum: measured.checksum,
    matchingEvidence: evidence,
  });
  expect(
    await readFile(workerFilePath(f.context, z.string().parse(installed.path))),
  ).toEqual(Buffer.from(z.instanceof(Uint8Array).parse(measured.content)));
  expect(
    subtitleTargetsReady(await currentSubtitleWork(f.db, f.asset.id, 0), 0),
  ).toBe(true);
  expect(provider.calls).toContain("/fixture");
});

test.each([
  { forced: true, hearingImpaired: "any" as const },
  { forced: false, hearingImpaired: "required" as const },
])(
  "ASSRT preserves unsupported exact constraints $forced/$hearingImpaired before provider calls",
  async (target) => {
    const f = await harness.setup();
    const provider = await harness.assrt(f.db);
    await recordPolicyTargets(f, [
      {
        sourceItemId: 1,
        language: "zh-Hans",
        audioLanguage: "zh",
        audio: "any",
        ...target,
      },
    ]);
    expect(await f.queue()).toBe(1);
    const [input] = await f.inputs();
    if (input === undefined) throw new Error("No exact Chinese target");
    expect(
      await createSubtitleActivities(f.network, {
        assrt: (context, search) =>
          fromAssrt(context, search, provider.transport),
      }).findMediaSubtitles(input),
    ).toMatchObject({ status: "waiting", reason: "unsupported-target" });
    expect(provider.calls).toEqual([]);
    expect(
      subtitleTargetsReady(await currentSubtitleWork(f.db, f.asset.id, 0), 0),
    ).toBe(false);
  },
);

test("audio exemptions omit targets while unknown required audio remains visible protection", async () => {
  const f = await harness.setup();
  const rules = {
    schemaVersion: 1,
    protectedReasons: [],
    targets: [
      {
        sourceItemId: 1,
        language: "en",
        audioLanguage: "en",
        forced: false,
        hearingImpaired: "any",
        audio: "exclude_matching",
      },
    ],
  };
  await f.db.mediaSubtitlePolicyVersion.create({
    data: {
      mediaId: f.media.id,
      actorId: f.user.id,
      version: 1,
      recoveryEpoch: 0,
      source: { fixture: true },
      rules,
    },
  });
  await f.db.libraryAsset.update({
    where: { id: f.asset.id },
    data: { properties: { audioLanguages: ["en"] } },
  });
  expect(await f.queue()).toBe(0);
  expect(await currentSubtitleWork(f.db, f.asset.id, 0)).toMatchObject({
    targets: [],
    protectedReasons: [],
  });
  await f.db.libraryAsset.update({
    where: { id: f.asset.id },
    data: { properties: {} },
  });
  expect(await f.queue()).toBe(0);
  expect(await currentSubtitleWork(f.db, f.asset.id, 0)).toMatchObject({
    protectedReasons: ["subtitle_audio_evidence_unknown"],
  });
  expect(
    await f.db.applicationEvent.count({
      where: { kind: "subtitle_target_protected" },
    }),
  ).toBe(1);
});

test("hearing-impaired required metadata cannot be replaced by ordinary captions", async () => {
  const f = await harness.setup();
  await recordPolicyTargets(f, [
    {
      sourceItemId: 1,
      language: "en",
      audioLanguage: "en",
      forced: false,
      hearingImpaired: "required",
      audio: "any",
    },
  ]);
  await f.queue();
  const [input] = await f.inputs();
  if (input === undefined) throw new Error("No target");
  const provider = subtitleTransport();
  expect(
    await createSubtitleActivities(f.network, {
      opensubtitles: (context, search) =>
        fromOpenSubtitles(context, search, provider.transport),
    }).findMediaSubtitles(input),
  ).toMatchObject({ status: "waiting" });
  expect(
    provider.calls
      .find((call) => call.path.endsWith("/subtitles"))
      ?.query.get("hearing_impaired"),
  ).toBe("only");
  expect(provider.calls.some((call) => call.path.endsWith("/download"))).toBe(
    false,
  );
});

test("a real new request skips stale staged evidence, acquires a current candidate and reuses installed quality without rewriting history", async () => {
  const f = await harness.setup();
  await f.queue();
  const oldInputs = await f.inputs();
  const oldInput = oldInputs.find((input) => !input.forced);
  if (oldInput === undefined) throw new Error("No regular target");
  const provider = subtitleTransport();
  const network = createSubtitleActivities(f.network, {
    opensubtitles: (context, input) =>
      fromOpenSubtitles(context, input, provider.transport),
  });
  const files = createMediaFileActivities(f.context);
  const old = await network.findMediaSubtitles(oldInput);
  expect(old.status).toBe("found");
  const oldRow = await f.db.subtitleAsset.findUniqueOrThrow({
    where: { id: old.subtitleId ?? "missing" },
  });
  await f.db.plexIdentityMapping.update({
    where: { userId: f.user.id },
    data: {
      userId: f.user.id,
      serverMachineId: "fixture",
      kind: "account",
      permittedSectionIds: ["1"],
      permittedMediaKinds: ["movie"],
      verifiedAt: new Date(),
    },
  });
  const commands = new MediaRequestCommands(f.db, {
    keepDays: 30,
    serverMachineId: "fixture",
  });
  const request = () =>
    commands.createRequest(f.user, crypto.randomUUID(), {
      mediaId: f.media.id,
      subtitleLanguages: ["en"],
      includeSpecials: false,
    });
  await request();
  const freshInputs = await f.inputs();
  const freshInput = freshInputs.find(
    (input) =>
      !input.forced && input.targetAuthority !== oldInput.targetAuthority,
  );
  if (freshInput === undefined)
    throw new Error("New request did not enqueue current target");
  await f.db.providerLease.updateMany({
    where: { providerId: "opensubtitles" },
    data: { nextAllowedAt: new Date(0) },
  });
  const fresh = await network.findMediaSubtitles(freshInput);
  expect(fresh.status).toBe("found");
  expect(fresh.subtitleId).not.toBe(old.subtitleId);
  expect(
    await files.installMediaSubtitles({
      operationId: oldInput.operationId,
      subtitleId: oldRow.id,
    }),
  ).toEqual({ status: "obsolete" });
  expect(
    await files.installMediaSubtitles({
      operationId: freshInput.operationId,
      subtitleId: fresh.subtitleId ?? "missing",
    }),
  ).toEqual({ status: "installed" });
  expect(
    await f.db.subtitleAsset.findUniqueOrThrow({ where: { id: oldRow.id } }),
  ).toEqual(oldRow);
  await request();
  // Queue correctly omits the satisfied installed target. An existing operation
  // with a new current authority can still observe its quality without re-download.
  expect(await f.queue()).toBe(0);
  expect(
    provider.calls.filter((call) => call.path.endsWith("/download")),
  ).toHaveLength(2);
});

test.each(["policy", "epoch", "asset"] as const)(
  "%s changes fence a previously validated candidate before any installation",
  async (change) => {
    const f = await harness.setup();
    await f.queue();
    const [input] = await f.inputs();
    if (input === undefined) throw new Error("No target");
    const provider = subtitleTransport();
    const found = await createSubtitleActivities(f.network, {
      opensubtitles: (context, search) =>
        fromOpenSubtitles(context, search, provider.transport),
    }).findMediaSubtitles(input);
    expect(found.status).toBe("found");
    if (change === "policy")
      await f.db.mediaSubtitlePolicyVersion.create({
        data: {
          mediaId: f.media.id,
          actorId: f.user.id,
          version: 1,
          recoveryEpoch: 0,
          source: { fixture: true },
          rules: { schemaVersion: 1, protectedReasons: [], targets: [] },
        },
      });
    if (change === "epoch")
      await f.db.mediaRuntimeState.update({
        where: { id: "singleton" },
        data: { recoveryEpoch: 1 },
      });
    if (change === "asset")
      await f.db.libraryAsset.update({
        where: { id: f.asset.id },
        data: { version: { increment: 1 } },
      });
    expect(
      await createMediaFileActivities(f.context).installMediaSubtitles({
        operationId: input.operationId,
        subtitleId: found.subtitleId ?? "missing",
      }),
    ).toEqual({ status: "obsolete" });
    expect(
      await f.db.subtitleAsset.findUniqueOrThrow({
        where: { id: found.subtitleId ?? "missing" },
      }),
    ).toMatchObject({ state: "validated", path: null });
  },
);

test("bounded due reconciliation starts missing imported policy targets even when upgrade monitoring is disabled", async () => {
  const f = await harness.setup();
  await f.db.mediaIntent.update({
    where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
    data: { monitoring: false },
  });
  const sweep = createSweepActivities(f.network);
  await sweep.sweepMediaWork({
    kind: "due",
    cursor: null,
    sweepId: crypto.randomUUID(),
  });
  expect(await f.inputs()).toHaveLength(2);
  await sweep.sweepMediaWork({
    kind: "due",
    cursor: null,
    sweepId: crypto.randomUUID(),
  });
  expect(await f.inputs()).toHaveLength(2);
});

test("disabled providers keep a target waiting without consuming quota", async () => {
  const f = await harness.setup();
  await f.queue();
  const [input] = await f.inputs();
  if (input === undefined) throw new Error("No target");
  await f.db.mediaProvider.updateMany({ data: { enabled: false } });
  const provider = subtitleTransport();
  const found = await createSubtitleActivities(f.network, {
    opensubtitles: (context, search) =>
      fromOpenSubtitles(context, search, provider.transport),
  }).findMediaSubtitles(input);
  expect(found.status).toBe("waiting");
  expect(provider.calls).toHaveLength(0);
});
