import { expect, test } from "vitest";
import { createSubtitleActivities } from "#automation/subtitles.ts";
import { fromOpenSubtitles, fromAssrt } from "#automation/subtitle-sources.ts";
import { z } from "zod";
import type { FetchTransport } from "#integrations/http.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { MediaRequestCommands } from "#infrastructure/request-commands.ts";
import { createSweepActivities } from "#automation/sweeps.ts";
import { targetHarness, subtitleTransport } from "./target-fixture.ts";
import {
  currentSubtitleWork,
  SubtitleWorkSchema,
  subtitleTargetsReady,
} from "./authority.ts";

const harness = targetHarness();

test("an ordinary language-only request queues ASSRT and installs proven Simplified Chinese without inventing forced or HI flags", async () => {
  const f = await harness.setup();
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
  await f.db.mediaRequest.update({
    where: { id: f.request.id },
    data: { subtitleLanguages: ["zh-Hans"] },
  });
  const credential = await f.db.credential.create({
    data: {
      kind: "provider",
      ciphertext: harness.cipher.encrypt(
        JSON.stringify({ token: "fixture" }),
        "provider:assrt",
      ),
    },
  });
  await f.db.mediaProvider.upsert({
    where: { id: "assrt" },
    create: { id: "assrt", enabled: true, credentialId: credential.id },
    update: { enabled: true, credentialId: credential.id },
  });
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
  const calls: string[] = [];
  const transport: FetchTransport = (url) => {
    calls.push(url.pathname);
    return Promise.resolve(
      url.hostname === "api.assrt.net"
        ? Response.json({
            status: 0,
            sub: {
              subs: [
                {
                  id: 42,
                  videoname: "人工翻译",
                  producer: { source: "人工翻译" },
                  filelist: [
                    {
                      f: "Film.2026.1080p.WEB-GROUP.zh-Hans.srt",
                      url: "https://file0.assrt.net/fixture",
                    },
                  ],
                },
              ],
            },
          })
        : new Response(
            "1\n00:00:01,000 --> 00:00:02,000\n这是我们的国家，欢迎来到这里\n",
          ),
    );
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
  expect(
    await f.db.subtitleAsset.findUniqueOrThrow({
      where: { id: found.subtitleId ?? "missing" },
    }),
  ).toMatchObject({
    state: "installed",
    qualityStatus: "accepted",
    forced: null,
    hearingImpaired: null,
  });
  expect(
    subtitleTargetsReady(await currentSubtitleWork(f.db, f.asset.id, 0), 0),
  ).toBe(true);
  expect(calls).toContain("/fixture");
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
  expect(
    await createSubtitleActivities(f.network, {
      assrt: (context, search) => fromAssrt(context, search, transport),
    }).findMediaSubtitles({
      operationId: exact.id,
      assetId: f.asset.id,
      language: "zh-Hans",
      forced: false,
      hearingImpaired: "any",
      targetAuthority: work.authority,
    }),
  ).toMatchObject({ status: "waiting", reason: "unsupported-target" });
  expect(calls).toHaveLength(count);
});

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
  await f.db.mediaSubtitlePolicyVersion.create({
    data: {
      mediaId: f.media.id,
      actorId: f.user.id,
      version: 1,
      recoveryEpoch: 0,
      source: { fixture: true },
      rules: {
        schemaVersion: 1,
        protectedReasons: [],
        targets: [
          {
            sourceItemId: 1,
            language: "en",
            audioLanguage: "en",
            forced: false,
            hearingImpaired: "required",
            audio: "any",
          },
        ],
      },
    },
  });
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
